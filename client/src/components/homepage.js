import TaskList from "./TaskList";
import { useTasks } from "../TaskProvider";

export default function Homepage() {
    const { tasks, error } = useTasks();

    if (error) return (
        <>Error occured: {error.message}</>
    );

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
