import { useEffect, useState } from "react";
import { getTasks } from "../services/task";
import TaskList from "./TaskList";

export default function Homepage() {
    const [tasks, setTasks] = useState([]);
    const [error, setError] = useState(null);

    useEffect(() => {
        const refreshData = async () => {
            setTasks(await getTasks().catch(setError));
        };

        refreshData();
    }, []);

    if (error) return (
        <>
        Error occured:
        {error.message}
        </>
    )
    return (
        <>
        <div style={{display: "flex"}}>
            <TaskList title="Today" tasks={tasks} />
            <TaskList title="This Week" tasks={tasks} />
            <TaskList title="Eventually" tasks={tasks} />
        </div>
        </>
    )
}
