import { createRoot } from "react-dom/client";
import "./monacoSetup";
import App from "./App";
import "./styles/_fonts.scss";
import "./styles/_tokens.scss";

createRoot(document.getElementById("root")!).render(<App />);
