import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { MorphingGLBScene } from "./App"
import reportWebVitals from './reportWebVitals';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <MorphingGLBScene />
  </React.StrictMode>
);

reportWebVitals();
