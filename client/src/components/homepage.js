import TaskList from "./TaskList";
import NewTaskModal from "./NewTaskModal";
import Calendar from "./Calendar";
import { useTasks } from "../TaskProvider";
import { useState } from "react";
import { displayToday, displayThisWeek, displayEventually } from "../utils";

export default function Homepage() {
    const { tasks, error } = useTasks();
    const [newTaskOpen, setNewTaskOpen] = useState(false);

    if (error) return (
        <>Error occured: {error.message}</>
    );

    return (
        <>
        <button onClick={() => setNewTaskOpen(true)}> New Task </button>
        <div style={{display: "flex"}}>
            <TaskList title="Today" tasks={tasks.filter(displayToday)} />
            <TaskList title="This Week" tasks={tasks.filter(displayThisWeek)} />
            <TaskList title="Eventually" tasks={tasks.filter(displayEventually)} />
            <TaskList title="Completed" tasks={tasks.filter((t) => t.is_completed)} />
        </div>
        <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
        <Calendar />
        </>
    )
    //return (
    //    <Calendar />
    //);
}
