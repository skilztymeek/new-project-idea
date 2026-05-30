/**
 * NYC Subway Virtual Tour — Web App entry point.
 * React + Photo Sphere Viewer application.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';

function App(): React.JSX.Element {
  return (
    <div>
      <h1>NYC Subway Virtual Tour</h1>
    </div>
  );
}

const rootElement = document.getElementById('root');
if (rootElement) {
  ReactDOM.createRoot(rootElement).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
