import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Layout from './Layout';
import Dashboard from './Dashboard';
import CommentEditStudio from './CommentEditStudio';
import Templates from './Templates';
import Sources from './Sources';
import Projects from './Projects';
import Settings from './Settings';
import ProjectEditor from './ProjectEditor';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="comment-edit-studio" element={<CommentEditStudio />} />
          <Route path="templates" element={<Templates />} />
          <Route path="sources" element={<Sources />} />
          <Route path="projects" element={<Projects />} />
          <Route path="projects/:projectId/edit/:jobId" element={<ProjectEditor />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
