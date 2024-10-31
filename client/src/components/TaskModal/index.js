import "./index.css";
import { formatDate } from "../../utils";
import { useState } from "react";
import { updateTask, addScheduledTime } from "../../services/task";
import { useTasks } from "../../TaskProvider";

const TaskModal = ({ task, open, onClose }) => {

    const { refreshTasks } = useTasks();

    const [isDescEdit, setDescEdit] = useState(false);
    const [desc, setDesc] = useState(task?.description);

    const [isTitleEdit, setTitleEdit] = useState(false);
    const [title, setTitle] = useState(task?.title);

    const [startDate, setStartDate] = useState(null);
    const [endDate, setEndDate] = useState(null);

    if (!open) return null;

    const update = async () => {
        if (isDescEdit) setDescEdit(false);
        if (isTitleEdit) setTitleEdit(false);
        if (desc !== task.description) {
            await updateTask(task._id, { description: desc });
            refreshTasks();
        }
        if (title !== task.title) {
            await updateTask(task._id, { title: title });
            refreshTasks();
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
                            {formatDate(time.start_time)} - {formatDate(time.end_time)}                             <button onClick={() => { }}>delete</button>
                        </li>
                    ))}
                </ul>

            New Scheduled Time: 
            <input type="datetime-local" onChange={(e) => setStartDate(e.target.value + "-05:00")}/> 
            - 
            <input type="datetime-local" onChange={(e) => setEndDate(e.target.value + "-05:00")}/> 
            <button onClick={() => {
                addScheduledTime(task._id, {start_time: startDate, end_time: endDate}); 
                refreshTasks();
            }}>Add</button>
            </div>
        </div>
    )
}

export default TaskModal;
