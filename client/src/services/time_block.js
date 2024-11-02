import { REACT_APP_API_URL, api} from "./config";

const TIME_BLOCK_URL = `${REACT_APP_API_URL}/time_block`;

export const deleteTimeBlock = async (id) => {
    let res = await api.delete(`${TIME_BLOCK_URL}/${id}`);
    return res.data;
}
