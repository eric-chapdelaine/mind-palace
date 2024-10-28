import "./index.css";
import { formatDate } from "../../utils";
import { useState } from "react";
import { updateTask } from "../../services/task";

const TaskModal = ({ task, open, onClose }) => {

    const [isDescEdit, setDescEdit] = useState(false);
    const [desc, setDesc] = useState(task?.description);

    const [isTitleEdit, setTitleEdit] = useState(false);
    const [title, setTitle] = useState(task?.title);

    if (!open) return null;

    const update = async () => {
        if (isDescEdit) setDescEdit(false);
        if (isTitleEdit) setTitleEdit(false);
        if (desc !== task.description) {
            await updateTask(task._id, { description: desc });
            setDesc(task.description);
        }
        if (title !== task.title) {
            await updateTask(task._id, { title: title });
            setTitle(task.title);
        }
    }

    return (
        <div className="modal" onClick={onClose}>
            <div className="modal-content" onClick={(e) => { e.stopPropagation(); update(); }}>
                {isTitleEdit ||
                    <h2 onClick={() => setTitleEdit(true)}>{task.title}</h2>}

                {isTitleEdit &&
                    <><input onClick={(e) => { e.stopPropagation() }}
                        defaultValue={task.title}
                        onChange={(e) => setTitle(e.target.value)}
                    /><br /></>}

                {task.due_date && (<><span>Due: {formatDate(task.due_date)}</span> <br /></>)}

                Completed:
                <input type="checkbox"
                    checked={task.is_completed}
                    onChange={async () => { await updateTask(task._id, { is_completed: !task.is_completed }) }} />
                <hr />

                {isDescEdit ||
                    <><button onClick={() => setDescEdit(true)}>Edit</button> <p onClick={() => setDescEdit(true)}>{task.description}</p></>}

                {isDescEdit &&
                    <textarea style={{ width: "750px", height: "250px" }}
                        onClick={(e) => e.stopPropagation()}
                        defaultValue={task.description}
                        onChange={(e) => setDesc(e.target.value)}></textarea>}

                <h3>Scheduled Times:</h3>
                <ul>
                    {task.scheduled_times.map((time) => (
                        <li>
                            {formatDate(time.start_time)} - {formatDate(time.end_time)} ({time.activity_type_id})
                            <button onClick={() => { }}>delete</button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    )
}

export default TaskModal;
