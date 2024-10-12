import { REACT_APP_API_URL, api } from "./config";

const TAG_API_URL = `${REACT_APP_API_URL}/tag`

export const getTagName = async (id) => {
    let res = await api.get(`${TAG_API_URL}/${id}`);
    return res.data.title;
}