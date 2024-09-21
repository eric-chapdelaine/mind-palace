import _axios from "axios";

const REACT_APP_API_URL = "http://172.18.0.2:8000";

const api = _axios.create();

export {REACT_APP_API_URL, api}