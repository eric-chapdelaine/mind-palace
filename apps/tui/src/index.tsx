import { render } from "ink";
import { App } from "./App";

/**
 * Mind Palace TUI — a full-screen dashboard for the Mind Palace server, meant to live in a
 * tmux pane next to the web app. It talks to the same Hono API (default http://127.0.0.1:4310,
 * override with MP_API_URL) and never touches the database itself.
 */
render(<App />, { exitOnCtrlC: false, alternateScreen: true }); // Ctrl+C handled by the app's keymap; alt screen so suspensions (editor) can leave/return cleanly