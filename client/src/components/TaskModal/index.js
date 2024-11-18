import "./index.css";
import { formatDate } from "../../utils";
import { useState } from "react";
import { updateTask, addScheduledTime, deleteTask } from "../../services/task";
import { deleteTimeBlock } from "../../services/time_block";
import { useTasks } from "../../TaskProvider";
import Markdown from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import 'katex/dist/katex.min.css'
import remarkGfm from "remark-gfm";

const dateToDisplay = (date) => {
    console.log(date);
    const newDate = new Date(new Date(date) - 5 * 60 * 60 * 1000);
    return newDate.toISOString().slice(0, 16);
}

const TaskModal = ({ task, open, onClose }) => {

    const { refreshTasks } = useTasks();

    const [isDescEdit, setDescEdit] = useState(false);
    const [desc, setDesc] = useState(task?.description);

    const [isTitleEdit, setTitleEdit] = useState(false);
    const [title, setTitle] = useState(task?.title);

    const [startDate, setStartDate] = useState(new Date());
    const [endDate, setEndDate] = useState(new Date());

    if (!open) return null;

    const update = async () => {
        if (isDescEdit) setDescEdit(false);
        if (isTitleEdit) setTitleEdit(false);
        if (desc !== task.description) {
            await updateTask(task._id, { description: desc });
            await refreshTasks();
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
                    <h2 onClick={() => setTitleEdit(true)}>
                        {task.title}
                        <button onClick={async () => {
                            onClose();
                            await deleteTask(task._id);
                            await refreshTasks();
                        }}>delete</button></h2>}

                {isTitleEdit &&
                    <><input onClick={(e) => { e.stopPropagation() }}
                        defaultValue={task.title}
                        onChange={(e) => setTitle(e.target.value)}
                    /><br /></>}

                {task.due_date && (<><span>Due: {formatDate(task.due_date)}</span> <br /></>)}

                Completed:
                <input type="checkbox"
                    checked={task.is_completed}
                    onChange={async () => {
                        await updateTask(task._id, { is_completed: !task.is_completed });
                        await refreshTasks();
                    }} />
                <hr />

                {isDescEdit ||
                    <>
                        <button onClick={() => setDescEdit(true)}>Edit</button>
                        <div onClick={() => setDescEdit(true)}>
                            <Markdown remarkPlugins={[remarkMath, remarkGfm]} rehypePlugins={[rehypeKatex]}>
                                {task.description}
                            </Markdown>
                        </div>
                    </>}

                {isDescEdit &&
                    <textarea style={{ width: "750px", height: "250px" }}
                        onClick={(e) => e.stopPropagation()}
                        defaultValue={task.description}
                        onChange={(e) => setDesc(e.target.value)}></textarea>}

                <h3>Scheduled Times:</h3>
                <ul>
                    {task.scheduled_times.map((time) => (
                        <li key={time._id}>
                            {formatDate(time.start_time)} - {formatDate(time.end_time)}                             <button onClick={async () => {
                                await deleteTimeBlock(time._id);
                                await refreshTasks();
                            }}>delete</button>
                        </li>
                    ))}
                </ul>

                New Scheduled Time:
                <input type="datetime-local" value={dateToDisplay(startDate)} onChange={(e) => {
                    setStartDate(new Date(e.target.value).toISOString());
                    setEndDate(new Date(new Date(e.target.value).getTime() + 30 * 60 * 1000).toISOString());
                }} />
                -
                <input type="datetime-local" value={dateToDisplay(endDate)} onChange={(e) => setEndDate(new Date(e.target.value).toISOString())} />
                <button onClick={async () => {
                    await addScheduledTime(task._id, { start_time: startDate, end_time: endDate });
                    await refreshTasks();
                }}>Add</button>
            </div>
        </div>
    )
}

export default TaskModal;
