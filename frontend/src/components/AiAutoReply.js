import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './AiAutoReply.css';
import { API_BASE_URL } from '../utils';

const AiAutoReply = () => {
  const [media, setMedia] = useState([]);
  const [selectedMedia, setSelectedMedia] = useState(null);
  const [results, setResults] = useState(null); // {replied, skipped}
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [manualReplies, setManualReplies] = useState({});
  const [aiConnected, setAiConnected] = useState(false);

  useEffect(() => {
    fetchMedia();
    // check AI/Gemini status
    axios.get(`${API_BASE_URL}/api/ai-status`)
      .then(res => {
        if (res.data.success) setAiConnected(res.data.connected);
      })
      .catch(() => setAiConnected(false));
  }, []);

  const fetchMedia = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${API_BASE_URL}/api/media`);
      if (res.data.success && res.data.data && res.data.data.data) {
        setMedia(res.data.data.data);
      }
    } catch (err) {
      setError('Could not load posts');
      console.error('AI media error', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSelect = async (mediaId) => {
    setSelectedMedia(mediaId);
    setResults(null);
    setError(null);
    try {
      setLoading(true);
      const res = await axios.post(`${API_BASE_URL}/api/ai-auto-reply/${mediaId}`);
      if (res.data.success) {
        setResults(res.data);
      }
    } catch (err) {
      const backendError = err.response?.data?.error;
      const errorText =
        typeof backendError === 'string'
          ? backendError
          : backendError?.error?.message || err.message;
      setError(`AI auto-reply failed: ${errorText}`);
      console.error('AI reply error', err);
    } finally {
      setLoading(false);
    }
  };

  const handleManualReplyChange = (id, text) => {
    setManualReplies(prev => ({ ...prev, [id]: text }));
  };

  const sendManualReply = async (commentId) => {
    const msg = manualReplies[commentId];
    if (!msg || !msg.trim()) return;
    try {
      setLoading(true);
      const res = await axios.post(`${API_BASE_URL}/api/comments/${commentId}/reply`, { message: msg });
      if (res.data.success) {
        alert('Manual reply sent');
        // remove from skipped list
        setResults(prev => {
          const newSkipped = (prev.skipped || []).filter(c => c.id !== commentId);
          return { ...prev, skipped: newSkipped };
        });
        setManualReplies(prev => {
          const nxt = { ...prev };
          delete nxt[commentId];
          return nxt;
        });
      }
    } catch (err) {
      setError('Failed to send manual reply');
      console.error('manual reply error', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ai-container">
      <h2>AI Auto‑Reply</h2>
      <p>
        Gemini status: {aiConnected ? <span style={{color:'green'}}>connected</span> : <span style={{color:'red'}}>not configured</span>}
      </p>
      <p>Select a post to let Gemini generate polite short replies (&lt;= 5 words). Longer comments will be listed below for you to answer.</p>

      {error && (
        <div className="ai-error">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <div className="ai-layout">
        <div className="ai-media-list">
          <h3>Your Posts</h3>
          {loading && <p className="loading">Loading posts...</p>}
          <div className="ai-posts">
            {media.map(p => (
              <div
                key={p.id}
                className={`ai-post-item ${selectedMedia === p.id ? 'active' : ''}`}
                onClick={() => handleSelect(p.id)}
              >
                <span className="ai-post-id">{p.id}</span>
                <span className="ai-post-caption">{p.caption?.substring(0, 30) || '(no caption)'}...</span>
              </div>
            ))}
          </div>
        </div>

        <div className="ai-results">
          {selectedMedia && loading && <p className="loading">Running AI replies...</p>}
          {results && (
            <>
              <div className="ai-section">
                <h4>Replied ({results.replied.length})</h4>
                <ul>
                  {results.replied.map(r => (
                    <li key={r.commentId}>{r.reply}</li>
                  ))}
                </ul>
              </div>

              <div className="ai-section">
                <h4>Manual follow‑ups ({results.skipped.length})</h4>
                {results.skipped.map(c => (
                  <div key={c.id} className="ai-skipped-item">
                    <strong>@{c.from?.username}</strong>: {c.text}
                    {c.reason && <p className="skip-reason">(skipped: {c.reason})</p>}
                    <textarea
                      placeholder="Your reply..."
                      value={manualReplies[c.id] || ''}
                      onChange={e => handleManualReplyChange(c.id, e.target.value)}
                      rows={2}
                    />
                    <button
                      onClick={() => sendManualReply(c.id)}
                      disabled={loading || !(manualReplies[c.id] && manualReplies[c.id].trim())}
                    >
                      Send Reply
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AiAutoReply;
