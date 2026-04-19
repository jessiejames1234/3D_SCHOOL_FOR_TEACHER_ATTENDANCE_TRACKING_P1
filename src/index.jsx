// Ensure config runs first (defines API_BASE)
import "./config.js";

// ensure api service runs and exposes globals
import "./services/api.js";

import App from "./App.jsx";

// Ensure styles load
import "./styles/App.css";

const rootEl = document.getElementById('root');
ReactDOM.render(React.createElement(App, null), rootEl);
