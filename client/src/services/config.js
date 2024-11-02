import _axios from "axios";

const REACT_APP_API_URL = "/api";

const api = _axios.create();

export {REACT_APP_API_URL, api}
