import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './CommentsManager.css';
import { API_BASE_URL } from '../utils';

const CommentsManager = () => {
  const [media, setMedia] = useState([]);
  const [comments, setComments] = useState([]);
  const [selectedMediaId, setSelectedMediaId] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [replyingTo, setReplyingTo] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [autoReplyStatus, setAutoReplyStatus] = useState(null); // {enabled, autoReplyMessage}

  useEffect(() => {
    fetchMedia();
  }, []);

  const fetchMedia = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/media`);
      if (response.data.success && response.data.data.data) {
        setMedia(response.data.data.data);
      }
    } catch (err) {
      setError('Failed to load media');
      console.error('Media error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleMediaSelect = async (mediaId) => {
    setSelectedMediaId(mediaId);
    // fetch auto-reply status for this post
    try {
      const statusRes = await axios.get(`${API_BASE_URL}/api/auto-reply-status/${mediaId}`);
      if (statusRes.data.success) {
        setAutoReplyStatus(statusRes.data.data);
      } else {
        setAutoReplyStatus(null);
      }
    } catch (err) {
      // ignore, just clear status
      setAutoReplyStatus(null);
    }

    await fetchComments(mediaId);
  };

  const fetchComments = async (mediaId) => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/comments/${mediaId}`);
      if (response.data.success && response.data.data.data) {
        setComments(response.data.data.data);
        // notify if auto-replies were triggered
        if (response.data.autoRepliesSent && response.data.autoRepliesSent > 0) {
          alert(`➤ Sent ${response.data.autoRepliesSent} auto‑reply${response.data.autoRepliesSent > 1 ? 's' : ''}`);
        }
      }
    } catch (err) {
      setError('Failed to load comments');
      console.error('Comments error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleReply = async (commentId) => {
    if (!replyText.trim()) {
      setError('Reply message cannot be empty');
      return;
    }

    try {
      setLoading(true);
      const response = await axios.post(`${API_BASE_URL}/api/comments/${commentId}/reply`, {
        message: replyText,
        username: comments.find(comment => comment.id === commentId)?.from?.username || null,
      });

      if (response.data.success) {
        setReplyText('');
        setReplyingTo(null);
        alert('Reply sent successfully!');
        if (selectedMediaId) {
          await fetchComments(selectedMediaId);
        }
      }
    } catch (err) {
      setError('Failed to send reply');
      console.error('Reply error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAutoReply = async () => {
    if (!selectedMediaId) return;
    if (window.confirm('Are you sure you want to delete this auto-reply configuration?')) {
      try {
        setLoading(true);
        const response = await axios.post(`${API_BASE_URL}/api/delete-auto-reply/${selectedMediaId}`);
        if (response.data.success) {
          setAutoReplyStatus(null);
          alert('Auto-reply deleted successfully!');
        }
      } catch (err) {
        setError('Failed to delete auto-reply');
        console.error('Delete error:', err);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleLikeAllComments = async () => {
    if (!selectedMediaId) return;
    if (!window.confirm('Like all comments on this post?')) return;
    try {
      setLoading(true);
      const response = await axios.post(`${API_BASE_URL}/api/comments/${selectedMediaId}/like-all`);
      if (response.data && response.data.success) {
        const { liked = 0, failed = 0, results = [] } = response.data;
        const failedItems = (results || []).filter(r => !r.success);
        if (failedItems.length > 0) {
          // Show concise summary and log details
          const summary = `Liked ${liked} comments, failed ${failedItems.length}`;
          console.error('Like-all failures:', failedItems);
          alert(summary + '\nSee console for failure details');
          setError(`Like-all: ${failedItems.length} failures (see console)`);
        } else {
          alert(`Liked ${liked} comments, failed ${failed}`);
        }
      } else {
        const errMsg = response.data?.error || 'Failed to like comments';
        setError(errMsg);
        console.error('Like-all response error:', response.data);
      }
    } catch (err) {
      console.error('Like-all error:', err);
      const message = err.response?.data?.error || err.message || 'Failed to like comments';
      setError(message);
    } finally {
      setLoading(false);
      if (selectedMediaId) await fetchComments(selectedMediaId);
    }
  };

  return (
    <div className="comments-container">
      <h2>Comments Manager</h2>

      {error && (
        <div className="comments-error">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="comments-layout">
        <div className="media-list">
          <h3>Your Posts</h3>
          <div className="media-items">
            {loading && <p className="loading">Loading posts...</p>}
            {media.length === 0 && !loading && (
              <p className="no-data">No posts found. Check your API credentials.</p>
            )}
            {media.map(post => (
              <div
                key={post.id}
                className={`media-item ${selectedMediaId === post.id ? 'active' : ''}`}
                onClick={() => handleMediaSelect(post.id)}
              >
                <div className="media-icon">📸</div>
                <div className="media-info">
                  <p className="media-caption">{post.caption?.substring(0, 50)}...</p>
                  <p className="media-meta">
                    {post.comments_count || 0} comments • {post.like_count || 0} likes
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="comments-list">
          <h3>
            {selectedMediaId ? 'Comments' : 'Select a post to view comments'}
          </h3>
          {selectedMediaId && (
            <div className="comments-actions">
              <button
                className="like-all-btn"
                onClick={handleLikeAllComments}
                disabled={loading || comments.length === 0}
              >
                👍 Like All Comments
              </button>
            </div>
          )}
          {selectedMediaId && autoReplyStatus && (
            <div className="auto-reply-info">
              <p className="auto-reply-indicator">
                ✉️ Auto-reply is <strong>{autoReplyStatus.enabled ? 'enabled' : 'disabled'}</strong> for this post
              </p>
              {autoReplyStatus.enabled && (
                <p className="auto-reply-message">
                  <em>Message:</em> "{autoReplyStatus.autoReplyMessage}"
                </p>
              )}
              <button className="delete-auto-reply-btn" onClick={handleDeleteAutoReply} disabled={loading}>
                🗑️ Delete Auto-Reply
              </button>
            </div>
          )}
          <div className="comments-items">
            {loading && <p className="loading">Loading comments...</p>}
            {selectedMediaId && comments.length === 0 && !loading && (
              <p className="no-data">No comments on this post yet.</p>
            )}
            {comments.map(comment => (
              <div key={comment.id} className="comment-item">
                <div className="comment-header">
                  <strong>{comment.from?.username || 'Unknown'}</strong>
                  <span className="comment-time">
                    {new Date(comment.timestamp).toLocaleDateString()}
                  </span>
                </div>
                <p className="comment-text">{comment.text}</p>
                <button
                  className="reply-btn"
                  onClick={() => setReplyingTo(comment.id)}
                >
                  Reply
                </button>

                {replyingTo === comment.id && (
                  <div className="reply-form">
                    <textarea
                      value={replyText}
                      onChange={e => setReplyText(e.target.value)}
                      placeholder="Type your reply..."
                      rows="3"
                    />
                    <div className="reply-actions">
                      <button
                        className="send-btn"
                        onClick={() => handleReply(comment.id)}
                        disabled={loading}
                      >
                        {loading ? 'Sending...' : 'Send Reply'}
                      </button>
                      <button
                        className="cancel-btn"
                        onClick={() => {
                          setReplyingTo(null);
                          setReplyText('');
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {comment.replies && comment.replies.data && comment.replies.data.length > 0 && (
                  <div className="replies">
                    <p className="replies-title">Replies:</p>
                    {comment.replies.data.map(reply => (
                      <div key={reply.id} className="reply-item">
                        <strong>{reply.from?.username}</strong>: {reply.text}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default CommentsManager;
