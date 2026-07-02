const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
require('dotenv').config();
const axios = require('axios');
const path = require('path');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const app = express();
const PORT = process.env.PORT || 5000;
const API_VERSION = process.env.INSTAGRAM_API_VERSION || 'v25.0';

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Routes
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'Server is running', message: 'Instagram Auto-Reply Backend' });
});

// Get comments for a specific media
app.get('/api/comments/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    const response = await fetchInstagramComments(mediaId, accessToken, { includeMediaFields: true });

    // if auto-reply is configured for this media, send replies to any new comments
    const config = autoReplyConfigs[mediaId];
    let autoRepliesSent = 0;
    if (config && config.enabled) {
      const commentsData = response.data.data || [];
      for (const comment of commentsData) {
        // check if this comment already has a reply to avoid duplicates
        if (!hasCommentReplies(comment)) {
          try {
            // format message with commenter's username: @username message
            const commenterHandle = comment.from?.username || 'user';
            const formattedMessage = `@${commenterHandle} ${config.autoReplyMessage}`;
            await axios.post(
              `https://graph.facebook.com/${API_VERSION}/${comment.id}/replies`,
              { message: formattedMessage },
              { params: { access_token: accessToken } }
            );
            autoRepliesSent += 1;
          } catch (err) {
            console.error('Error sending auto-reply to comment', comment.id, err.response?.data || err.message);
          }
        }
      }
      // refetch comments once more so that returned data includes the newly posted replies
      try {
        const refreshed = await fetchInstagramComments(mediaId, accessToken, { includeMediaFields: true });
        response.data = refreshed.data;
      } catch (refetchErr) {
        console.error('Error refetching comments after auto-reply:', refetchErr.response?.data || refetchErr.message);
      }
    }

    res.status(200).json({
      success: true,
      data: response.data,
      autoRepliesSent,
    });
  } catch (error) {
    console.error('Error fetching comments:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});


// status endpoint for Gemini connectivity
app.get('/api/ai-status', (req, res) => {
  const connected = !!process.env.GEMINI_API_KEY;
  res.status(200).json({ success: true, connected });
});

// AI-auto-reply endpoint (runs Gemini and sends polite replies for short comments)
app.post('/api/ai-auto-reply/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const mediaCaption = await fetchMediaCaption(mediaId, accessToken);

    // fetch comments similar to existing endpoint
    const commentResp = await fetchInstagramComments(mediaId, accessToken, { includeMediaFields: true });
    const commentsData = commentResp.data.data || [];
    const replied = [];
    const skipped = [];

    for (const comment of commentsData) {
      console.log('[AI] processing comment', comment.id, 'text="' + comment.text + '"', 'hasReply=', hasCommentReplies(comment));
      if (hasCommentReplies(comment)) continue; // skip if already has any reply

      const escalation = shouldEscalateToAdmin(comment.text);
      if (escalation.escalate) {
        skipped.push({ ...comment, reason: escalation.reason });
        continue;
      }


      // generate AI reply using Gemini
      const aiText = await generateAiReply(comment.text, mediaCaption);
      if (!aiText) {
        skipped.push({ ...comment, reason: 'no ai output' });
        continue;
      }
      const commenter = comment.from?.username || 'user';

      // Use the AI response directly for all replies, including devotional ones, as Gemini handles them well.
      const devotional = !!getDevotionalEcho(comment.text);
      const formatted = `@${commenter} ${aiText}`;

      try {
        await axios.post(
          `https://graph.facebook.com/${API_VERSION}/${comment.id}/replies`,
          { message: formatted },
          { params: { access_token: accessToken } }
        );
        replied.push({
          commentId: comment.id,
          reply: formatted,
          originalText: comment.text,
          from: comment.from?.username || null,
          devotional: !!devotional,
        });
      } catch (err) {
        console.error('Error sending AI reply for comment', comment.id, err.response?.data || err.message);
        skipped.push(comment);
      }
    }

    // store skipped comments for later retrieval (including skip reason when available)
    aiSkippedComments[mediaId] = skipped;

    // refetch comments so frontend sees replies
    let refreshed;
    try {
      refreshed = await fetchInstagramComments(mediaId, accessToken, { includeMediaFields: true });
    } catch (err) {
      console.error('Error refetching after AI replies:', err.response?.data || err.message);
    }

    res.status(200).json({
      success: true,
      replied,
      skipped,
      comments: refreshed?.data || commentResp.data,
    });
  } catch (error) {
    console.error('AI auto-reply error:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// Endpoint to fetch skipped comments for a mediaId
app.get('/api/ai-skipped/:mediaId', (req, res) => {
  const { mediaId } = req.params;
  const list = aiSkippedComments[mediaId] || [];
  res.status(200).json({ success: true, data: list });
});

app.get('/api/unreplied-comments/:mediaId', async (req, res) => {
  try {
    const { mediaId } = req.params;
    const { after } = req.query;
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const [mediaCaption, commentResp] = await Promise.all([
      fetchMediaCaption(mediaId, accessToken),
      fetchInstagramComments(mediaId, accessToken, { after, includeMediaFields: true }),
    ]);

    const commentsData = commentResp.data.data || [];
    const ignoredIds = getIgnoredComments(mediaId);
    const comments = [];

    for (const comment of commentsData) {
      if (hasCommentReplies(comment)) continue;
      if (isCommentIgnored(mediaId, comment.id)) continue;

      const suggestedReply = await generateAiReply(comment.text, mediaCaption);
      comments.push({
        ...comment,
        suggestedReply,
        ignored: ignoredIds.includes(comment.id),
      });
    }

    res.status(200).json({
      success: true,
      data: {
        mediaId,
        mediaCaption,
        ignoredCount: ignoredIds.length,
        comments,
        nextCursor: commentResp.data?.paging?.cursors?.after || null,
        hasMore: !!commentResp.data?.paging?.next,
      },
    });
  } catch (error) {
    console.error('Error fetching unreplied comments:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// Custom endpoint to generate suggested AI replies on-demand
app.post('/api/ai-suggest-reply', async (req, res) => {
  try {
    const { commentText, mediaCaption, instruction } = req.body;
    const suggestedReply = await generateAiReply(commentText, mediaCaption, instruction);
    res.status(200).json({ success: true, suggestedReply });
  } catch (error) {
    console.error('Error generating AI suggestion:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/comments/:commentId/ignore', (req, res) => {
  try {
    const { commentId } = req.params;
    const { mediaId } = req.body;

    if (!mediaId) {
      return res.status(400).json({
        success: false,
        error: 'mediaId is required',
      });
    }

    const ignored = markCommentIgnored(mediaId, commentId);
    res.status(200).json({
      success: true,
      message: 'Comment ignored',
      data: {
        mediaId,
        commentId,
        ignoredCount: ignored.length,
      },
    });
  } catch (error) {
    console.error('Error ignoring comment:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// Endpoint to delete auto-reply configuration for a mediaId
app.post('/api/delete-auto-reply/:mediaId', (req, res) => {
  const { mediaId } = req.params;
  if (autoReplyConfigs[mediaId]) {
    delete autoReplyConfigs[mediaId];
    res.status(200).json({
      success: true,
      message: 'Auto-reply configuration deleted',
    });
  } else {
    res.status(404).json({
      success: false,
      error: 'No auto-reply configuration found for this mediaId',
    });
  }
});

// Endpoint to check auto-reply status for a mediaId
app.get('/api/auto-reply-status/:mediaId', (req, res) => {
  const { mediaId } = req.params;
  const config = autoReplyConfigs[mediaId];
  if (!config) {
    return res.status(404).json({ success: false, error: 'No auto-reply config for this mediaId' });
  }
  res.status(200).json({
    success: true,
    data: {
      mediaId,
      enabled: config.enabled,
      autoReplyMessage: config.autoReplyMessage,
    },
  });
});

// Reply to a comment
app.post('/api/comments/:commentId/reply', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { message, username } = req.body;
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!message) {
      return res.status(400).json({
        success: false,
        error: 'Message is required',
      });
    }

    const formattedMessage = formatReplyMessage(message, username);

    const response = await axios.post(
      `https://graph.facebook.com/${API_VERSION}/${commentId}/replies`,
      {
        message: formattedMessage,
      },
      {
        params: {
          access_token: accessToken,
        },
      }
    );

    res.status(200).json({
      success: true,
      message: formattedMessage,
      data: response.data,
    });
  } catch (error) {
    console.error('Error replying to comment:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// Like all comments for a media
app.post('/api/comments/:mediaId/like-all', async (req, res) => {
  const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
  try {
    const { mediaId } = req.params;
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;

    if (!accessToken) {
      console.error('INSTAGRAM_ACCESS_TOKEN is not configured');
      return res.status(500).json({ success: false, error: 'INSTAGRAM_ACCESS_TOKEN not configured' });
    }

    // fetch comments for the media
    const response = await axios.get(
      `https://graph.facebook.com/${API_VERSION}/${mediaId}/comments`,
      {
        params: {
          fields: 'id',
          access_token: accessToken,
        },
      }
    );

    const comments = response.data.data || [];
    const results = [];
    let successCount = 0;
    let failCount = 0;

    for (const comment of comments) {
      try {
        await axios.post(
          `https://graph.facebook.com/${API_VERSION}/${accountId}/likes`,
          {},
          { params: { access_token: accessToken, comment_id: comment.id } }
        );
        results.push({ commentId: comment.id, success: true });
        successCount += 1;
      } catch (err) {
        const errData = err.response?.data || err.message;
        console.error(`Failed liking comment ${comment.id}:`, errData);
        results.push({ commentId: comment.id, success: false, error: errData });
        failCount += 1;
      }
    }

    res.status(200).json({ success: true, liked: successCount, failed: failCount, results });
  } catch (error) {
    console.error('Error liking comments:', error.response?.data || error.message);
    res.status(500).json({ success: false, error: error.response?.data || error.message });
  }
});

// Get media (posts) from the business account
app.get('/api/media', async (req, res) => {
  try {
    const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const response = await axios.get(
      `https://graph.facebook.com/${API_VERSION}/${accountId}/media`,
      {
        params: {
          fields: 'id,caption,media_type,media_product_type,timestamp,like_count,comments_count',
          access_token: accessToken,
        },
      }
    );

    res.status(200).json({
      success: true,
      data: response.data,
    });
  } catch (error) {
    console.error('Error fetching media:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.response?.data || error.message,
    });
  }
});

// in-memory store for auto-reply configurations
const autoReplyConfigs = {}; // { [mediaId]: { autoReplyMessage, enabled } }

// in-memory store for AI-skip comments by media
const aiSkippedComments = {}; // { [mediaId]: [commentObject] }
const ignoredCommentsByMedia = {}; // { [mediaId]: [commentId, ...] }
const MAX_AUTO_REPLY_COMMENT_WORDS = 18;
const MAX_AUTO_REPLY_COMMENT_CHARS = 120;
const COMMENT_FIELDS = 'id,text,from{id,username},timestamp,replies.limit(10){id,text,from{id,username}}';
const COMMENT_MEDIA_FIELDS = 'id,text,from{id,username},timestamp,media_url,thumbnail_url,image_url,gif_url,attachment,attachments,replies.limit(10){id,text,from{id,username}}';

function getIgnoredComments(mediaId) {
  return ignoredCommentsByMedia[mediaId] || [];
}

function isCommentIgnored(mediaId, commentId) {
  return getIgnoredComments(mediaId).includes(commentId);
}

function markCommentIgnored(mediaId, commentId) {
  const next = new Set(getIgnoredComments(mediaId));
  next.add(commentId);
  ignoredCommentsByMedia[mediaId] = Array.from(next);
  return ignoredCommentsByMedia[mediaId];
}

function hasCommentReplies(comment) {
  return !!(comment && comment.replies && comment.replies.data && comment.replies.data.length > 0);
}

function getMediaUrlFromComment(comment) {
  return (
    comment?.media_url ||
    comment?.thumbnail_url ||
    comment?.image_url ||
    comment?.gif_url ||
    comment?.attachment?.media?.image?.src ||
    comment?.attachment?.media?.image_url ||
    comment?.attachment?.media?.url ||
    comment?.attachment?.media_url ||
    comment?.attachment?.url ||
    comment?.attachments?.data?.[0]?.media?.image?.src ||
    comment?.attachments?.data?.[0]?.media?.image_url ||
    comment?.attachments?.data?.[0]?.media?.url ||
    comment?.attachments?.data?.[0]?.media_url ||
    comment?.attachments?.data?.[0]?.url ||
    comment?.media?.image?.src ||
    comment?.media?.url ||
    null
  );
}

function normalizeComment(comment) {
  return {
    ...comment,
    commentMediaUrl: getMediaUrlFromComment(comment),
  };
}

async function fetchInstagramComments(mediaId, accessToken, options = {}) {
  const { after = null, limit = 25, includeMediaFields = false } = options;
  const fields = includeMediaFields ? COMMENT_MEDIA_FIELDS : COMMENT_FIELDS;

  try {
    const response = await axios.get(`https://graph.facebook.com/${API_VERSION}/${mediaId}/comments`, {
      params: {
        fields,
        access_token: accessToken,
        limit,
        ...(after ? { after } : {}),
      },
    });

    if (response.data?.data) {
      response.data.data = response.data.data.map(normalizeComment);
    }

    return response;
  } catch (err) {
    if (includeMediaFields) {
      console.error('Media field fetch failed, falling back to basic comment fields:', err.response?.data || err.message);
      const response = await axios.get(`https://graph.facebook.com/${API_VERSION}/${mediaId}/comments`, {
        params: {
          fields: COMMENT_FIELDS,
          access_token: accessToken,
          limit,
          ...(after ? { after } : {}),
        },
      });

      if (response.data?.data) {
        response.data.data = response.data.data.map(normalizeComment);
      }

      return response;
    }

    throw err;
  }
}

async function fetchMediaCaption(mediaId, accessToken) {
  try {
    const mediaResp = await axios.get(`https://graph.facebook.com/${API_VERSION}/${mediaId}`, {
      params: {
        fields: 'caption',
        access_token: accessToken,
      },
    });
    return mediaResp.data?.caption || '';
  } catch (mediaErr) {
    console.error('Error fetching media caption:', mediaErr.response?.data || mediaErr.message);
    return '';
  }
}

function formatReplyMessage(message, username) {
  const text = (message || '').trim();
  if (!text) return '';
  const handle = (username || '').trim().replace(/^@+/, '');
  if (!handle) return text;
  if (text.startsWith(`@${handle}`)) return text;
  return `@${handle} ${text}`;
}

// Word/character limit calculations
function getCommentLengthInfo(text) {
  const normalized = (text || '').trim();
  const words = normalized ? normalized.split(/\s+/).filter(Boolean).length : 0;
  return { words, chars: normalized.length };
}

function shouldEscalateToAdmin(text) {
  const { words, chars } = getCommentLengthInfo(text);
  const isLong = words > MAX_AUTO_REPLY_COMMENT_WORDS || chars > MAX_AUTO_REPLY_COMMENT_CHARS;
  if (!isLong) {
    return { escalate: false, reason: '' };
  }
  return {
    escalate: true,
    reason: `needs admin: long comment (${words} words, ${chars} chars)`,
  };
}

function extractRelevantEmoji(text) {
  const input = (text || '').toLowerCase();
  const fromComment = (text || '').match(/\p{Extended_Pictographic}/gu);
  if (fromComment && fromComment.length > 0) {
    return fromComment[0];
  }

  if (/(haha|hehe|lol|lmao|rofl|hasi|laugh|funny|moj|maja|pagala)/i.test(input)) return '\u{1F602}';
  if (/(love|beautiful|nice|great|awesome|super|mast|bhalo|accha|badiya)/i.test(input)) return '\u{1F60D}';
  if (/(thanks|thank you|dhanyavad|dhanyabaad|shukriya)/i.test(input)) return '\u{1F64F}';
  if (/(food|khana|delivery|hungry|tasty)/i.test(input)) return '\u{1F60B}';
  if (/(sad|sorry|miss|pain|alone)/i.test(input)) return '\u{1F97A}';
  return '\u{1F60A}';
}

function ensureEmoji(replyText, commentText) {
  const text = (replyText || '').trim();
  if (!text) return '';
  const hasEmoji = /\p{Extended_Pictographic}/u.test(text);
  if (hasEmoji) return text;
  return `${text} ${extractRelevantEmoji(commentText)}`.trim();
}

function isEmojiOnlyText(text) {
  const value = (text || '').trim();
  if (!value) return false;
  const hasEmoji = /\p{Extended_Pictographic}/u.test(value);
  if (!hasEmoji) return false;
  const nonEmoji = value
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\uFE0F\u200D]/g, '')
    .replace(/[\s.,!?'"`~_*+=|\\/:;()[\]{}-]/g, '');
  return nonEmoji.length === 0;
}

function getDevotionalEcho(commentText) {
  const text = (commentText || '').trim();
  if (!text) return '';

  const devotionalPatterns = [
    /jai?\s*jagannath/i,
    /jay\s*jagannath/i,
    /har\s*har\s*mahadev/i,
    /jai?\s*shree\s*ram/i,
    /jay\s*shree\s*ram/i,
    /radhe\s*radhe/i,
    /jai?\s*mata\s*di/i,
    /waheguru/i,
    /allah\s*hu\s*akbar/i,
  ];

  for (const pattern of devotionalPatterns) {
    const match = text.match(pattern);
    if (match && match[0]) {
      return match[0].trim();
    }
  }

  return '';
}

function inferCaptionTone(captionText) {
  const value = (captionText || '').toLowerCase();
  if (!value) return 'neutral';
  if (/(comedy|funny|haha|lol|meme|joke|roast|prank)/i.test(value)) return 'funny';
  if (/(jagannath|mahadev|shree ram|radhe|krishna|god|bhakti|devotional)/i.test(value)) return 'devotional';
  return 'neutral';
}

function isFunnyComment(commentText, mediaCaption) {
  const combined = `${commentText || ''} ${mediaCaption || ''}`.toLowerCase();
  const hasLaughEmoji = /[🤣😂😆😅😁]/u.test(combined);
  const hasPlayfulWords = /(\bhaha\b|\bhehe\b|\blol\b|\blmao\b|\brofl\b|\bfunny\b|\blaugh\b|\bjoke\b|\broast\b|\bprank\b|\bmeme\b|\bcomedy\b|\bcomic\b)/i.test(combined);
  const hasPlayfulOdiaMix = /\b(emiti|thila|last\s*ku|aka|habara|trust\s*my\s*feed)\b/i.test(combined);
  return hasLaughEmoji || hasPlayfulWords || hasPlayfulOdiaMix;
}

function getFunnyReply(commentText) {
  const trimmed = (commentText || '').trim();
  if (isEmojiOnlyText(trimmed)) {
    return trimmed;
  }
  return ensureEmoji('Ha ha', trimmed);
}

// helper to call Google Gemini for a polite reply
async function generateAiReply(commentText, mediaCaption, instruction = '') {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Gemini API key not configured');
    }
    const trimmedComment = (commentText || '').trim();
    if (!trimmedComment) {
      return 'Thank you!';
    }

    if (isEmojiOnlyText(trimmedComment)) {
      return trimmedComment;
    }

    const captionTone = inferCaptionTone(mediaCaption);
    const prompt = [
      'You are replying to Instagram comments.',
      'Write one natural, human-like reply in the same language as the comment.',
      'Audience is mostly Odia speakers.',
      'If the comment is in Odia (Odia script or Odia written in English letters), reply in natural Odia.',
      'If the comment mixes Odia with Hindi or English, match that same mix naturally.',
      'If the comment contains only emoji, reply with the same emoji only.',
      'If the comment is devotional (example: Jay Jagannath), reply with the same devotional phrase.',
      'For funny/comedy posts or clearly funny comments, use a light funny tone and a laugh style response.',
      'For devotional posts, keep a respectful devotional tone.',
      'Sound warm and personal, not robotic.',
      'Use 4 to 12 words.',
      'Use at most one emoji, only when it feels natural.',
      'Do not include hashtags.',
      'Do not ask for private information.',
      'Return only the reply text.',
      instruction ? `Additional special instructions to follow: ${instruction}` : '',
      '',
      `Post caption: "${(mediaCaption || '').trim()}"`,
      `Detected caption tone: ${captionTone}`,
      `Comment: "${trimmedComment}"`,
    ].filter(Boolean).join('\n');

    // gemini-2.5-flash with v1beta is the primary working configuration (using thinkingBudget: 0 to return results immediately)
    const modelConfigs = [
      { name: 'gemini-2.5-flash', version: 'v1beta', config: { temperature: 0.7, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } } },
      { name: 'gemini-2.0-flash', version: 'v1beta', config: { temperature: 0.7, maxOutputTokens: 200 } },
      { name: 'gemini-1.5-flash', version: 'v1', config: { temperature: 0.7, maxOutputTokens: 200 } }
    ];

    let lastError = null;

    for (const mc of modelConfigs) {
      try {
        const response = await axios.post(
          `https://generativelanguage.googleapis.com/${mc.version}/models/${mc.name}:generateContent`,
          {
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: mc.config,
          },
          {
            params: {
              key: apiKey,
            },
            timeout: 20000,
          }
        );

        // Extract text from Gemini generateContent response.
        const parts = response.data?.candidates?.[0]?.content?.parts || [];
        const text = parts
          .map((p) => p?.text || '')
          .join(' ')
          .trim();

        if (text) {
          if (isEmojiOnlyText(trimmedComment)) return trimmedComment;
          return ensureEmoji(text.slice(0, 220), trimmedComment);
        }
      } catch (modelErr) {
        lastError = modelErr;
      }
    }

    if (lastError) {
      console.error('Gemini model error:', lastError.response?.data || lastError.message);
    } else {
      console.log('[Gemini] no text returned; using fallback.');
    }

    // Rule-based fallbacks if Gemini API is exhausted/fails
    const echoed = getDevotionalEcho(trimmedComment);
    if (echoed) return echoed;
    if (captionTone === 'funny' || isFunnyComment(trimmedComment, mediaCaption)) {
      return getFunnyReply(trimmedComment);
    }
    return ensureEmoji('Thank you so much!', trimmedComment);
  } catch (err) {
    console.error('Gemini error:', err.response?.data || err.message);
    // Safe fallbacks on ultimate error
    const echoed = getDevotionalEcho(commentText);
    if (echoed) return echoed;
    return ensureEmoji('Thank you so much!', commentText);
  }
}

// Auto-reply to all new comments (setup auto-reply template)
app.post('/api/setup-auto-reply', async (req, res) => {
  try {
    const { mediaId, autoReplyMessage, enabled } = req.body;

    if (!mediaId || typeof enabled === 'undefined') {
      return res.status(400).json({
        success: false,
        error: 'mediaId and enabled flag are required',
      });
    }

    // store/update the auto-reply configuration in memory
    autoReplyConfigs[mediaId] = {
      autoReplyMessage: autoReplyMessage || '',
      enabled: !!enabled,
    };

    // In a production app, you'd persist this to a database instead of memory
    res.status(200).json({
      success: true,
      message: 'Auto-reply configuration saved',
      config: {
        mediaId,
        autoReplyMessage: autoReplyConfigs[mediaId].autoReplyMessage,
        enabled: autoReplyConfigs[mediaId].enabled,
      },
    });
  } catch (error) {
    console.error('Error setting up auto-reply:', error.message);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
  });
});

// Start server
const server = app.listen(PORT, () => {
  console.log(`[OK] Server running on port ${PORT}`);
  console.log(`[OK] Instagram API Version: ${API_VERSION}`);
  console.log(`[OK] Environment: ${process.env.NODE_ENV}`);
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`[ERROR] Port ${PORT} is already in use.`);
    console.error('[ERROR] Stop the existing process or run with a different PORT.');
    console.error('[HINT] PowerShell: netstat -ano | findstr :5000');
    console.error('[HINT] PowerShell: taskkill /PID <PID> /F');
    process.exit(1);
  }

  console.error('[ERROR] Failed to start server:', error.message);
  process.exit(1);
});
