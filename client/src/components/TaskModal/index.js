import "./index.css";
import {formatDate} from "../../utils";

const TaskModal = ({task, open, onClose}) => {
    if (!open) return null;

    return (
        <div className="modal" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <h2>{task.title}</h2>
                {task.due_date && (<><span>Due: {formatDate(task.due_date)}</span> <br /></>)}
                Completed: <input type="checkbox" checked={task.is_completed} onChange={() => {}} />
                <hr />
                <p>{task.description}</p>
            </div>
        </div>
    )
}

export default TaskModal;