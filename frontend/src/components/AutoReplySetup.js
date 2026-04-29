import React, { useState } from 'react';
import axios from 'axios';
import './AutoReplySetup.css';
import { API_BASE_URL } from '../utils';

const AutoReplySetup = () => {
  const [formData, setFormData] = useState({
    mediaId: '',
    autoReplyMessage: '',
    enabled: true,
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState(null);
  const [templates, setTemplates] = useState([
    { id: 1, name: 'Thank You', text: 'Thank you for your comment! 🙏' },
    { id: 2, name: 'Follow Us', text: 'Thanks for the love! Make sure to follow us for more updates 😊' },
    { id: 3, name: 'Check DM', text: 'Thanks for commenting! Please check your DMs for more info.' },
  ]);

  const handleInputChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value,
    }));
  };

  const handleTemplateSelect = (text) => {
    setFormData(prev => ({
      ...prev,
      autoReplyMessage: text,
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!formData.mediaId || !formData.autoReplyMessage) {
      setError('Please fill in all required fields');
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const response = await axios.post(`${API_BASE_URL}/api/setup-auto-reply`, {
        mediaId: formData.mediaId,
        autoReplyMessage: formData.autoReplyMessage,
        enabled: formData.enabled,
      });

      if (response.data.success) {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 3000);
        setFormData({
          mediaId: '',
          autoReplyMessage: '',
          enabled: true,
        });
      }
    } catch (err) {
      setError('Failed to setup auto-reply');
      console.error('Setup error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="setup-container">
      <h2>Auto-Reply Setup</h2>
      <p className="setup-subtitle">Configure automatic replies for your Instagram comments</p>

      {error && (
        <div className="setup-error">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {success && (
        <div className="setup-success">
          ✓ Auto-reply configuration saved successfully!
        </div>
      )}

      <div className="setup-layout">
        <div className="setup-form-section">
          <h3>Configure Auto-Reply</h3>
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="mediaId">Post ID *</label>
              <input
                type="text"
                id="mediaId"
                name="mediaId"
                value={formData.mediaId}
                onChange={handleInputChange}
                placeholder="Enter the Instagram post ID"
                required
              />
              <span className="input-hint">You can find the post ID from your post URL</span>
            </div>

            <div className="form-group">
              <label htmlFor="autoReplyMessage">Auto-Reply Message *</label>
              <textarea
                id="autoReplyMessage"
                name="autoReplyMessage"
                value={formData.autoReplyMessage}
                onChange={handleInputChange}
                placeholder="Enter the message to be sent automatically to comments"
                rows="5"
                required
              />
              <span className="input-hint">
                Character count: {formData.autoReplyMessage.length}/300
              </span>
            </div>

            <div className="form-group checkbox">
              <input
                type="checkbox"
                id="enabled"
                name="enabled"
                checked={formData.enabled}
                onChange={handleInputChange}
              />
              <label htmlFor="enabled">Enable auto-reply for this post</label>
            </div>

            <button
              type="submit"
              className="submit-btn"
              disabled={loading}
            >
              {loading ? 'Setting up...' : '🚀 Setup Auto-Reply'}
            </button>
          </form>
        </div>

        <div className="templates-section">
          <h3>Message Templates</h3>
          <p className="templates-subtitle">Click a template to use it as a starting point</p>
          <div className="templates-list">
            {templates.map(template => (
              <div
                key={template.id}
                className="template-card"
                onClick={() => handleTemplateSelect(template.text)}
              >
                <h4>{template.name}</h4>
                <p>{template.text}</p>
                <button type="button" className="use-template-btn">
                  Use Template
                </button>
              </div>
            ))}
          </div>

          <div className="tips-section">
            <h4>✨ Tips for Better Auto-Replies</h4>
            <ul>
              <li>Keep messages short and friendly</li>
              <li>Use emojis to make responses more engaging</li>
              <li>Personalize messages when possible</li>
              <li>Include a call-to-action (like follow, visit, etc.)</li>
              <li>Test the message before enabling for all posts</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="setup-info">
        <h3>How It Works</h3>
        <ol>
          <li>
            <strong>Enter Post ID:</strong> Get the post ID from your Instagram post URL
          </li>
          <li>
            <strong>Set Message:</strong> Create an auto-reply message using templates or write your own
          </li>
          <li>
            <strong>Enable:</strong> Toggle the checkbox to enable auto-reply for the post
          </li>
          <li>
            <strong>Monitor:</strong> Go to Comments tab to see all replies and manage them
          </li>
        </ol>
      </div>

      <div className="api-info">
        <h4>🔧 API Information</h4>
        <p><strong>API Version:</strong> v25.0</p>
        <p><strong>Endpoints Used:</strong> media, comments, replies</p>
        <p className="warning">
          Note: Make sure your Instagram Business Account has proper permissions and API credentials configured in the backend.
        </p>
      </div>
    </div>
  );
};

export default AutoReplySetup;
