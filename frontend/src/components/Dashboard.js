import React, { useState, useEffect } from 'react';
import axios from 'axios';
import './Dashboard.css';
import { API_BASE_URL } from '../utils';

const Dashboard = () => {
  const [stats, setStats] = useState({
    media: 0,
    comments: 0,
    replies: 0,
    status: 'inactive',
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchDashboardData();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      const response = await axios.get(`${API_BASE_URL}/api/media`);
      
      if (response.data.success) {
        const mediaCount = response.data.data.data?.length || 0;
        const totalComments = response.data.data.data?.reduce((sum, item) => sum + (item.comments_count || 0), 0) || 0;

        setStats({
          media: mediaCount,
          comments: totalComments,
          replies: 0,
          status: 'connected',
        });
      }
    } catch (err) {
      setError('Failed to fetch dashboard data. Check your Instagram API credentials.');
      console.error('Dashboard error:', err);
      setStats(prev => ({ ...prev, status: 'error' }));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="dashboard-container">
      <h2>Dashboard Overview</h2>
      
      {error && <div className="dashboard-error">{error}</div>}

      <div className="stats-grid">
        <div className="stat-card media-card">
          <div className="stat-icon">📸</div>
          <div className="stat-content">
            <h3>Posts</h3>
            <p className="stat-value">{stats.media}</p>
          </div>
        </div>

        <div className="stat-card comments-card">
          <div className="stat-icon">💬</div>
          <div className="stat-content">
            <h3>Comments</h3>
            <p className="stat-value">{stats.comments}</p>
          </div>
        </div>

        <div className="stat-card replies-card">
          <div className="stat-icon">↩️</div>
          <div className="stat-content">
            <h3>Auto-Replies</h3>
            <p className="stat-value">{stats.replies}</p>
          </div>
        </div>

        <div className="stat-card status-card">
          <div className="stat-icon">🔌</div>
          <div className="stat-content">
            <h3>API Status</h3>
            <p className={`stat-value status-${stats.status}`}>{stats.status.toUpperCase()}</p>
          </div>
        </div>
      </div>

      <div className="dashboard-info">
        <h3>Quick Start Guide</h3>
        <ol>
          <li>Go to <strong>Auto-Reply Setup</strong> to configure auto-reply messages</li>
          <li>Navigate to <strong>Comments</strong> to view and manage comments</li>
          {/* <li>Set up your Instagram API credentials in the backend <code>.env</code> file</li> */}
          <li>Enable auto-reply for specific posts</li>
        </ol>
      </div>

      <button className="refresh-btn" onClick={fetchDashboardData} disabled={loading}>
        {loading ? 'Loading...' : '🔄 Refresh Data'}
      </button>
    </div>
  );
};

export default Dashboard;
