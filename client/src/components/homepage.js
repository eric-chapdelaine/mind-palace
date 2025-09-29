import NewTaskModal from "./NewTaskModal";
import WeekCalendar from "./WeekCalendar";
import { useTasks } from "../TaskProvider";
import { useState, useRef, useEffect } from "react";
import { displayToday, displayThisWeek, displayEventually, formatDate } from "../utils";
import "./homepage.css";

// TODO: below component is for testing, once completed, write in the TaskList file
const TaskList = ({title, tasks}) => {
  if (!tasks || tasks.length === 0) {
    return;
  }

  return (
    <>
      <h2>{title}</h2>
      <table>
        <tr>
          <th>Title</th>
          <th>Status</th>
          <th>Due Date</th>
        </tr>
        {tasks.map((task) => (
          <tr>
            <td>{task.title}</td>
            <td>
              <input 
                type="checkbox" 
                checked={task.is_completed} 
                readOnly />
            </td>
            <td>
              {formatDate(task.due_date)}
            </td>
          </tr>
        ))}
      </table>
      </>
  )
}

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
      <TaskList title={"Today"} tasks={tasks.filter(displayToday)} />
      <TaskList title={"This Week"} tasks={tasks.filter(displayThisWeek)} />
      <TaskList title={"Eventually"} tasks={tasks.filter(displayEventually)} />
      </div>
        <div className="divider" onMouseDown={handleMouseDown}> </div>
            <div className="right-panel" style={{ flexBasis: `calc(100% - ${leftWidth} - 5px` }}>
                <WeekCalendar tasks={tasks} />
            </div>
    </div>
  )
}
