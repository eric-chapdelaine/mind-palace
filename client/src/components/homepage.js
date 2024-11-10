import TaskList from "./TaskList";
import NewTaskModal from "./NewTaskModal";
import Calendar from "./Calendar";
import { useTasks } from "../TaskProvider";
import { useState, useRef, useEffect } from "react";
import { displayToday, displayThisWeek, displayEventually } from "../utils";
import "./homepage.css";

export default function Homepage() {
    const { tasks, error } = useTasks();
    const [newTaskOpen, setNewTaskOpen] = useState(false);
    const [leftWidth, setLeftWidth] = useState('50%');
    const homepageRef = useRef(null);
    const isDragging = useRef(false);

    const handleMouseDown = () => {
        isDragging.current = true;
        document.body.style.cursor = 'col-resize';
    }

     const handleMouseMove = (e) => {
    if (!isDragging.current || !homepageRef.current) return;

    const containerRect = homepageRef.current.getBoundingClientRect();
    const newLeftWidth = ((e.clientX - containerRect.left) / containerRect.width) * 100;
        console.log(newLeftWidth);

    // Set a minimum and maximum width for the panels
    if (newLeftWidth > 10 && newLeftWidth < 90) {
      setLeftWidth(`${newLeftWidth}%`);
    }
  };

  const handleMouseUp = () => {
    isDragging.current = false;
    document.body.style.cursor = 'default';
  };

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

    if (error) return (
        <>Error occured: {error.message}</>
    );


    return (
        <div className="homepage" ref={homepageRef}>
            <div className="left-panel" style={{ flexBasis: leftWidth }}>
                <button onClick={() => setNewTaskOpen(true)}> New Task </button>
                <NewTaskModal open={newTaskOpen} onClose={() => setNewTaskOpen(false)} />
                <div style={{display: "flex"}}>
                    <TaskList title="Today" tasks={tasks.filter(displayToday)} />
                    <TaskList title="This Week" tasks={tasks.filter(displayThisWeek)} />
                    <TaskList title="Eventually" tasks={tasks.filter(displayEventually)} />
                    <TaskList title="Completed" tasks={tasks.filter((t) => t.is_completed)} />
                </div>
            </div>
        <div className="divider" onMouseDown={handleMouseDown}> </div>
            <div className="right-panel" style={{ flexBasis: `calc(100% - ${leftWidth} - 5px` }}>
                <Calendar />
            </div>
        </div>
    )
}
