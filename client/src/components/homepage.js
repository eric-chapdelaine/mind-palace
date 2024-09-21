import { useEffect, useState } from "react";
import { getTasks } from "../services/task";
import TaskCard from "./TaskCard";

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
        <h1>Tasks</h1>

        {tasks.map((task, idx) => (
            <TaskCard task={task} key={idx} />
        ))}

        </>
    )
}