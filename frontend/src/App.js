import React, { useState, useEffect } from 'react';
import './App.css';
import Dashboard from './components/Dashboard';
import CommentsManager from './components/CommentsManager';
import AutoReplySetup from './components/AutoReplySetup';
import PostsManager from './components/PostsManager';
import AiAutoReply from './components/AiAutoReply';
import UnrepliedMessages from './components/UnrepliedMessages';

function App() {
  const [currentPage, setCurrentPage] = useState('dashboard');
  const [error, setError] = useState(null);
  const [aiConnected, setAiConnected] = useState(false);

  useEffect(() => {
    // Check server connection
    fetch('/api/health')
      .then(res => res.json())
      .catch(err => {
        setError('Cannot connect to backend server. Make sure Node.js server is running on port 5000.');
        console.error('Connection error:', err);
      });

    // fetch Gemini/AI status
    fetch('/api/ai-status')
      .then(r => r.json())
      .then(data => {
        if (data.success) setAiConnected(!!data.connected);
      })
      .catch(() => {
        setAiConnected(false);
      });
  }, []);

  const handleNavigation = (page) => {
    setCurrentPage(page);
    setError(null);
  };

  return (
    <div className="App">
      <header className="app-header">
        <div className="header-content">
          <h1>📱 Instagram Auto-Reply</h1>
          <p className="subtitle">Automatically reply to Instagram comments</p>
        </div>
      </header>

      {error && (
        <div className="error-banner">
          <span>{error}</span>
          <button onClick={() => setError(null)}>✕</button>
        </div>
      )}

      <nav className="app-nav">
        <button
          className={`nav-btn ${currentPage === 'dashboard' ? 'active' : ''}`}
          onClick={() => handleNavigation('dashboard')}
        >
          Dashboard
        </button>
        <button
          className={`nav-btn ${currentPage === 'posts' ? 'active' : ''}`}
          onClick={() => handleNavigation('posts')}
        >
          Posts
        </button>
        <button
          className={`nav-btn ${currentPage === 'comments' ? 'active' : ''}`}
          onClick={() => handleNavigation('comments')}
        >
          Comments
        </button>
        <button
          className={`nav-btn ${currentPage === 'setup' ? 'active' : ''}`}
          onClick={() => handleNavigation('setup')}
        >
          Auto-Reply Setup
        </button>
        <button
          className={`nav-btn ${currentPage === 'ai' ? 'active' : ''}`}
          onClick={() => handleNavigation('ai')}
        >
          AI Replies {aiConnected ? '🟢' : '🔴'}
        </button>
        <button
          className={`nav-btn ${currentPage === 'unreplied' ? 'active' : ''}`}
          onClick={() => handleNavigation('unreplied')}
        >
          Unreplied Inbox
        </button>
      </nav>

      <main className="app-main">
        {currentPage === 'dashboard' && <Dashboard />}
        {currentPage === 'posts' && <PostsManager />}
        {currentPage === 'ai' && <AiAutoReply />}
        {currentPage === 'unreplied' && <UnrepliedMessages aiConnected={aiConnected} />}
        {currentPage === 'comments' && <CommentsManager />}
        {currentPage === 'setup' && <AutoReplySetup />}
      </main>

      <footer className="app-footer">
        <p>© 2024 Instagram Auto-Reply App | powered by Instagram API v24.0</p>
      </footer>
    </div>
  );
}

export default App;
