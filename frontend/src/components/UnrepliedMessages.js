import React, { useCallback, useEffect, useRef, useState } from 'react';
import axios from 'axios';
import './UnrepliedMessages.css';
import { API_BASE_URL } from '../utils';

const PAGE_SIZE = 25;

function getCommentMediaUrl(comment) {
  return (
    comment?.commentMediaUrl ||
    comment?.media_url ||
    comment?.thumbnail_url ||
    comment?.attachment?.media?.image?.src ||
    comment?.attachment?.media?.image_url ||
    comment?.attachment?.media?.url ||
    comment?.attachment?.media_url ||
    comment?.attachment?.url ||
    comment?.media?.image?.src ||
    comment?.media?.url ||
    comment?.image_url ||
    comment?.gif_url ||
    null
  );
}

function hasCommentMedia(comment) {
  return !!getCommentMediaUrl(comment) || !!comment?.attachment || !!comment?.media;
}

const UnrepliedMessages = ({ aiConnected = false }) => {
  const [media, setMedia] = useState([]);
  const [selectedMediaId, setSelectedMediaId] = useState(null);
  const [comments, setComments] = useState([]);
  const [mediaCaption, setMediaCaption] = useState('');
  const [loadingMedia, setLoadingMedia] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyDrafts, setReplyDrafts] = useState({});
  const [nextCursor, setNextCursor] = useState(null);
  const [hasMore, setHasMore] = useState(false);
  const [regeneratingCommentId, setRegeneratingCommentId] = useState(null);
  const [customInstructions, setCustomInstructions] = useState({});

  const inboxRef = useRef(null);
  const sentinelRef = useRef(null);

  const fetchMedia = useCallback(async () => {
    try {
      setLoadingMedia(true);
      const response = await axios.get(`${API_BASE_URL}/api/media`);
      if (response.data.success && response.data.data.data) {
        setMedia(response.data.data.data);
      }
    } catch (err) {
      setError('Failed to load posts');
      console.error('Unreplied media error:', err);
    } finally {
      setLoadingMedia(false);
    }
  }, []);

  const fetchInboxPage = useCallback(async (mediaId, after = null, append = false) => {
    if (!mediaId) return;
    if (append) {
      if (loadingInbox || loadingMore || !hasMore || !nextCursor) return;
    }

    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoadingInbox(true);
      }

      const response = await axios.get(`${API_BASE_URL}/api/unreplied-comments/${mediaId}`, {
        params: after ? { after, limit: PAGE_SIZE } : { limit: PAGE_SIZE },
      });

      if (response.data.success) {
        const inbox = response.data.data || {};
        const incomingComments = inbox.comments || [];

        setMediaCaption(inbox.mediaCaption || '');
        setNextCursor(inbox.nextCursor || null);
        setHasMore(!!inbox.hasMore);

        setComments((prev) => {
          if (!append) return incomingComments;
          const existingIds = new Set(prev.map((comment) => comment.id));
          const merged = [...prev];
          incomingComments.forEach((comment) => {
            if (!existingIds.has(comment.id)) {
              merged.push(comment);
            }
          });
          return merged;
        });
      }
    } catch (err) {
      setError('Failed to load unreplied messages');
      console.error('Unreplied comments error:', err);
    } finally {
      setLoadingInbox(false);
      setLoadingMore(false);
    }
  }, [loadingInbox, loadingMore, hasMore, nextCursor]);

  useEffect(() => {
    fetchMedia();
  }, [fetchMedia]);

  useEffect(() => {
    if (!selectedMediaId || !sentinelRef.current || !inboxRef.current) {
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const [entry] = entries;
        if (!entry?.isIntersecting) return;
        if (!hasMore || loadingInbox || loadingMore || actionLoading || !nextCursor) return;
        fetchInboxPage(selectedMediaId, nextCursor, true);
      },
      {
        root: inboxRef.current,
        rootMargin: '180px',
        threshold: 0.1,
      }
    );

    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [selectedMediaId, hasMore, loadingInbox, loadingMore, actionLoading, nextCursor, fetchInboxPage]);

  const handleMediaSelect = async (mediaId) => {
    setSelectedMediaId(mediaId);
    setError(null);
    setReplyingTo(null);
    setReplyDrafts({});
    setComments([]);
    setMediaCaption('');
    setNextCursor(null);
    setHasMore(false);
    await fetchInboxPage(mediaId, null, false);
  };

  const refreshInbox = async () => {
    if (!selectedMediaId) return;
    setComments([]);
    setNextCursor(null);
    setHasMore(false);
    setReplyingTo(null);
    setReplyDrafts({});
    await fetchInboxPage(selectedMediaId, null, false);
  };

  const openReplyEditor = (comment) => {
    setReplyingTo(comment.id);
    setReplyDrafts((prev) => ({
      ...prev,
      [comment.id]: prev[comment.id] ?? comment.suggestedReply ?? 'Thanks for your comment!',
    }));
  };

  const updateReplyDraft = (commentId, value) => {
    setReplyDrafts((prev) => ({
      ...prev,
      [commentId]: value,
    }));
  };

  const regenerateAiSuggestion = async (comment, instruction = '') => {
    try {
      setRegeneratingCommentId(comment.id);
      setError(null);
      const response = await axios.post(`${API_BASE_URL}/api/ai-suggest-reply`, {
        commentText: comment.text,
        mediaCaption: mediaCaption,
        instruction: instruction,
      });

      if (response.data.success) {
        const newSuggestion = response.data.suggestedReply;
        setComments((prev) =>
          prev.map((c) => (c.id === comment.id ? { ...c, suggestedReply: newSuggestion } : c))
        );
        setReplyDrafts((prev) => ({
          ...prev,
          [comment.id]: newSuggestion,
        }));
      }
    } catch (err) {
      setError('Failed to regenerate suggestion');
      console.error('Regenerate suggestion error:', err);
    } finally {
      setRegeneratingCommentId(null);
    }
  };

  const removeCommentFromState = (commentId) => {
    setComments((prev) => prev.filter((comment) => comment.id !== commentId));
    setReplyingTo((prev) => (prev === commentId ? null : prev));
    setReplyDrafts((prev) => {
      const next = { ...prev };
      delete next[commentId];
      return next;
    });
  };

  const sendReply = async (comment, messageOverride = null) => {
    const message = (messageOverride ?? replyDrafts[comment.id] ?? '').trim();
    if (!message) {
      setError('Reply message cannot be empty');
      return;
    }

    try {
      setActionLoading(true);
      const response = await axios.post(`${API_BASE_URL}/api/comments/${comment.id}/reply`, {
        message,
        username: comment.from?.username || null,
      });

      if (response.data.success) {
        removeCommentFromState(comment.id);
      }
    } catch (err) {
      setError('Failed to send reply');
      console.error('Reply send error:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const ignoreComment = async (comment) => {
    try {
      setActionLoading(true);
      const response = await axios.post(`${API_BASE_URL}/api/comments/${comment.id}/ignore`, {
        mediaId: selectedMediaId,
      });

      if (response.data.success) {
        removeCommentFromState(comment.id);
      }
    } catch (err) {
      setError('Failed to ignore comment');
      console.error('Ignore comment error:', err);
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="unreplied-container">
      <div className="unreplied-header">
        <div>
          <p className="eyebrow">Inbox</p>
          <h2>Unreplied Messages</h2>
          <p className="unreplied-subtitle">
            Comments with no replies show up here. Scroll down and we will keep pulling more automatically.
          </p>
        </div>
        <div className={`ai-badge ${aiConnected ? 'connected' : 'fallback'}`}>
          {aiConnected ? 'AI ready' : 'AI fallback'}
        </div>
      </div>

      <div className="unreplied-layout">
        <aside className="unreplied-posts">
          <div className="panel-title">
            <div>
              <h3>Your Posts</h3>
              <p className="panel-summary">Pick a post to open its unreplied inbox.</p>
            </div>
            <button className="refresh-btn" onClick={fetchMedia} disabled={loadingMedia}>
              Refresh
            </button>
          </div>

          <div className="posts-scroll">
            {loadingMedia && <div className="empty-state">Loading posts...</div>}
            {media.length === 0 && !loadingMedia && <div className="empty-state">No posts found.</div>}

            {media.map((post) => (
              <button
                key={post.id}
                className={`post-card ${selectedMediaId === post.id ? 'active' : ''}`}
                onClick={() => handleMediaSelect(post.id)}
              >
                <span className="post-card-id">{post.id}</span>
                <span className="post-card-caption">{post.caption?.substring(0, 48) || '(no caption)'}</span>
                <span className="post-card-meta">
                  {post.comments_count || 0} comments | {post.like_count || 0} likes
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="unreplied-panel">
          <div className="panel-title">
            <div>
              <h3>{selectedMediaId ? 'Unreplied Feed' : 'Select a post to start'}</h3>
              <p className="panel-summary">
                {selectedMediaId
                  ? 'Reply, ignore, or let the AI suggestion guide you. New pages load as you scroll.'
                  : 'The inbox opens automatically after you pick a post.'}
              </p>
            </div>
            {selectedMediaId && (
              <button className="refresh-btn" onClick={refreshInbox} disabled={loadingInbox || loadingMore || actionLoading}>
                Reload
              </button>
            )}
          </div>

          {mediaCaption && (
            <div className="caption-strip">
              <strong>Selected post caption</strong>
              <span>{mediaCaption}</span>
            </div>
          )}

          {error && (
            <div className="unreplied-error">
              <span>{error}</span>
              <button onClick={() => setError(null)}>x</button>
            </div>
          )}

          <div className="inbox-scroll" ref={inboxRef}>
            {loadingInbox && <div className="feed-loader top">Loading inbox...</div>}
            {selectedMediaId && !loadingInbox && comments.length === 0 && <div className="empty-state">No unreplied comments found.</div>}

            {comments.map((comment) => {
              const draft = replyDrafts[comment.id] ?? comment.suggestedReply ?? '';
              const isEditing = replyingTo === comment.id;

              return (
                <article key={comment.id} className="comment-card">
                  <div className="comment-head">
                    <div>
                      <strong>@{comment.from?.username || 'unknown'}</strong>
                      <span className="comment-time">{new Date(comment.timestamp).toLocaleString()}</span>
                    </div>
                    <span className="comment-badge">No replies</span>
                  </div>

                  <div className="comment-body">
                    <p className="comment-text">{comment.text}</p>
                    {hasCommentMedia(comment) && (
                      <div className="comment-media">
                        <div className="comment-media-label">Attached media</div>
                        {getCommentMediaUrl(comment) ? (
                          <img
                            className="comment-media-preview"
                            src={getCommentMediaUrl(comment)}
                            alt="Comment attachment preview"
                            loading="lazy"
                          />
                        ) : (
                          <div className="comment-media-fallback">
                            This comment includes media, but the API did not return a direct preview URL.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="suggestion-box">
                    <div className="suggestion-label">
                      <span>AI suggested reply</span>
                      <button
                        className="regenerate-icon-btn"
                        onClick={() => regenerateAiSuggestion(comment)}
                        disabled={regeneratingCommentId === comment.id}
                      >
                        {regeneratingCommentId === comment.id ? 'Regenerating...' : '🔄 Regenerate'}
                      </button>
                    </div>
                    <p>{comment.suggestedReply || 'Thank you!'}</p>
                  </div>

                  {isEditing && (
                    <div className="reply-editor">
                      <textarea
                        rows="3"
                        value={draft}
                        onChange={(e) => updateReplyDraft(comment.id, e.target.value)}
                        placeholder="Edit your reply..."
                      />
                      
                      <div className="custom-ai-instruction">
                        <input
                          type="text"
                          placeholder="Tell Gemini how to reply (e.g., 'reply in Odia', 'be funny')"
                          value={customInstructions[comment.id] || ''}
                          onChange={(e) =>
                            setCustomInstructions((prev) => ({
                              ...prev,
                              [comment.id]: e.target.value,
                            }))
                          }
                        />
                        <button
                          className="ai-write-btn"
                          onClick={() => regenerateAiSuggestion(comment, customInstructions[comment.id] || '')}
                          disabled={regeneratingCommentId === comment.id}
                        >
                          {regeneratingCommentId === comment.id ? 'Thinking...' : '✨ Ask Gemini to Write'}
                        </button>
                      </div>

                      <div className="reply-actions">
                        <button className="send-btn" onClick={() => sendReply(comment)} disabled={actionLoading}>
                          Send Override Reply
                        </button>
                        <button
                          className="secondary-btn"
                          onClick={() => {
                            setReplyingTo(null);
                            setReplyDrafts((prev) => {
                              const next = { ...prev };
                              delete next[comment.id];
                              return next;
                            });
                          }}
                          disabled={actionLoading}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {!isEditing && (
                    <div className="card-actions">
                      <button
                        className="primary-btn"
                        onClick={() => sendReply(comment, comment.suggestedReply || 'Thanks for your comment!')}
                        disabled={actionLoading || !comment.suggestedReply}
                      >
                        Send AI Reply
                      </button>
                      <button className="secondary-btn" onClick={() => openReplyEditor(comment)} disabled={actionLoading}>
                        Override
                      </button>
                      <button className="ghost-btn" onClick={() => ignoreComment(comment)} disabled={actionLoading}>
                        Ignore
                      </button>
                    </div>
                  )}
                </article>
              );
            })}

            {selectedMediaId && (loadingMore || hasMore) && (
              <div className="feed-loader bottom" ref={sentinelRef}>
                {loadingMore ? (
                  <>
                    <span className="spinner" />
                    <span>Loading more comments...</span>
                  </>
                ) : (
                  <span>Scroll for more</span>
                )}
              </div>
            )}

            {selectedMediaId && !hasMore && comments.length > 0 && !loadingMore && (
              <div className="feed-end">You reached the end of this inbox.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default UnrepliedMessages;
