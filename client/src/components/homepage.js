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
        {/* TODO: fix this when we decide on the setup of the task lists */}
        <div style={{display: "flex"}}>
            <TaskList title="Scheduled Today" tasks={tasks} />
            <TaskList title="Up Next" tasks={tasks} />
        </div>
        </>
    )
}