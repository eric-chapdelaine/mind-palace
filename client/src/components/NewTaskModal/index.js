import "./index.css";
import { useState, useEffect } from "react";
import { useTasks } from "../../TaskProvider";
import { createTask } from "../../services/task";
import { createTagsFromCSV } from "../../utils";

// TODO: remove code duplication between this and TaskModal
const NewTaskModal = ({ open, onClose }) => {

    const { refreshTasks } = useTasks();

    const [title, setTitle] = useState("");
    const [desc, setDesc] = useState("");
    const [dueDate, setDueDate] = useState(undefined);
    const [tags, setTags] = useState("");

    useEffect(() => {
        setTitle("");
        setDesc("");
        setDueDate(undefined);
        setTags("");
    }, [open]);

    if (!open) return null;


    return (
        <div className="modal" onClick={onClose}>
            <div className="modal-content" onClick={(e) => { e.stopPropagation() }}>
            <h2>Create New Task</h2>
            <label>Title: </label>
            <input type="text" onChange={(e) => setTitle(e.target.value)} />
            <br />
            <label>Tags: </label>
            <input type="text" onChange={(e) => setTags(e.target.value)} />
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
                let tag_array = await createTagsFromCSV(tags);
                await createTask({
                    title: title,
                    description: desc,
                    due_date: dueDate,
                    tags: tag_array
                });
                await refreshTasks();
                onClose();
            }}>Create</button>
            </div>
        </div>
    )
};

export default NewTaskModal;
