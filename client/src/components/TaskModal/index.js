import "./index.css";
import {formatDate} from "../../utils";
import { useEffect, useState } from "react";

const TaskModal = ({task, open, onClose}) => {
    if (!open) return null;

    const [activities, setActivities] = useState([]);

    useEffect(() => {

        const fetchActivities = async () => {
            try {

            } catch (error) {
                // TODO: figure out what to do with errors
            }
        }

        fetchActivities();

    }, [task.activities]);

    return (
        <div className="modal" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h2>{task.title}</h2>
                {task.due_date && (<><span>Due: {formatDate(task.due_date)}</span> <br /></>)}
                Completed: <input type="checkbox" checked={task.is_completed} onChange={() => {}} />
                <hr />
                <p>{task.description}</p>
                <h3>Activities:</h3>
                {task.activities.map((a) => (
                    <>
                    {/* {a}  */}
                    Story work: Oct 20, 12:00AM - Oct 20, 1:00 AM
                    <br />
                    </>
                ))}
            </div>
        </div>
    )
}

export default TaskModal;