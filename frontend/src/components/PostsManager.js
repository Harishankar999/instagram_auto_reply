import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './PostsManager.css';
import { API_BASE_URL } from '../utils';

const PostsManager = () => {
  const [media, setMedia] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchMedia();
  }, []);

  const fetchMedia = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/media`);
      if (response.data.success && response.data.data && response.data.data.data) {
        setMedia(response.data.data.data);
      } else {
        setError('Unable to load posts');
      }
    } catch (err) {
      setError('Failed to fetch posts');
      console.error('Media error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="posts-container">
      <h2>Your Posts</h2>

      {error && (
        <div className="posts-error">
          {error}
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      {loading && <p className="loading">Loading posts...</p>}

      {!loading && media.length === 0 && (
        <p className="no-data">No posts found. Check your API credentials.</p>
      )}

      <div className="posts-list">
        {media.map(post => (
          <div key={post.id} className="post-item">
            <div className="post-info">
              <strong>ID:</strong> <span className="post-id">{post.id}</span>
              <p className="post-caption">{post.caption || '(no caption)'}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default PostsManager;
