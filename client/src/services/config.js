import _axios from "axios";

const REACT_APP_API_URL = "http://localhost:8000";

const api = _axios.create();

export {REACT_APP_API_URL, api}