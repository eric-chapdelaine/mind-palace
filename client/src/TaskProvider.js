import { createContext, useContext, useEffect, useState} from "react";
import { getTasks } from "./services/task";

const TaskContext = createContext();

export function TaskProvider({ children }) {
    const [tasks, setTasks] = useState([]);
    const [error, setError] = useState(null);

    const refreshTasks = async () => {
        try {
            const fetchedTasks = await getTasks();
            setTasks(fetchedTasks);
        } catch (err) {
            setError(err);
        }
    };

    useEffect(() => {
            refreshTasks();
    }, []);

    return (
    <TaskContext.Provider value={{ tasks, refreshTasks, error }}>
        {children}
    </TaskContext.Provider>
    );
}

export function useTasks() {
    return useContext(TaskContext);
}
