import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './Layout';
import Dashboard from './Dashboard';
import CommentEditStudio from './CommentEditStudio';
import Templates from './Templates';
import Sources from './Sources';
import Projects from './Projects';
import Settings from './Settings';
import ProjectEditor from './ProjectEditor';
import Login from './Login';

function App() {
  const [currentUser, setCurrentUser] = useState(() => localStorage.getItem('fillwise_user') || '');

  const handleLoginSuccess = (username) => {
    setCurrentUser(username);
    localStorage.setItem('fillwise_user', username);
  };

  const handleLogout = () => {
    setCurrentUser('');
    localStorage.removeItem('fillwise_user');
  };

  return (
    <BrowserRouter>
      {!currentUser ? (
        <Routes>
          <Route path="*" element={<Login onLoginSuccess={handleLoginSuccess} />} />
        </Routes>
      ) : (
        <Routes>
          <Route path="/" element={<Layout currentUser={currentUser} onLogout={handleLogout} />}>
            <Route index element={<Dashboard />} />
            <Route path="comment-edit-studio" element={<CommentEditStudio />} />
            <Route path="templates" element={<Templates />} />
            <Route path="sources" element={<Sources />} />
            <Route path="projects" element={<Projects />} />
            <Route path="projects/:projectId/edit/:jobId" element={<ProjectEditor />} />
            <Route path="settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      )}
    </BrowserRouter>
  );
}

export default App;
