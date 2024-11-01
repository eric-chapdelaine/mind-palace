import "./index.css";
import { useState } from "react";
import { useTasks } from "../../TaskProvider";
import { createTask } from "../../services/task";

// TODO: remove code duplication between this and TaskModal
const NewTaskModal = ({ open, onClose }) => {

    const { refreshTasks } = useTasks();

    const [title, setTitle] = useState("");
    const [desc, setDesc] = useState("");
    const [dueDate, setDueDate] = useState(undefined);

    if (!open) return null;

    return (
        <div className="modal" onClick={onClose}>
            <div className="modal-content" onClick={(e) => { e.stopPropagation() }}>
            <h2>Create New Task</h2>
            <label>Title: </label>
            <input type="text" onChange={(e) => setTitle(e.target.value)} />
            <br />
            <label>Description: </label>
            <input type="text" onChange={(e) => setDesc(e.target.value)} />
            <br />
            <label>Due Date: </label>
            <input type="datetime-local" onChange={(e) => 
                setDueDate(new Date(e.target.value).toISOString())
            } />
            <br />
            <button onClick={async () => {
                await createTask({
                    title: title,
                    description: desc,
                    due_date: dueDate
                });
                await refreshTasks();
                onClose();
            }}>Create</button>
            </div>
        </div>
    )
};

export default NewTaskModal;
