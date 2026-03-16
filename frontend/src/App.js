import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Layout from "@/components/Layout";
import UploadPage from "@/pages/UploadPage";
import ProcessingPage from "@/pages/ProcessingPage";
import ApprovalPage from "@/pages/ApprovalPage";
import SuccessPage from "@/pages/SuccessPage";
import "@/App.css";

function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<UploadPage />} />
          <Route path="/processing/:sessionId" element={<ProcessingPage />} />
          <Route path="/approval/:sessionId" element={<ApprovalPage />} />
          <Route path="/success/:sessionId" element={<SuccessPage />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}

export default App;
