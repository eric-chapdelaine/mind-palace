import "./index.css";
import TaskCard from "../TaskCard";

const TaskList = ({title, tasks}) => {
    return (
        <div className="task-list-container">
            <div className="task-list-title">{title}</div>
            <div className="task-list">
                {tasks.map((task) => (
                    <TaskCard key={task._id} task={task} />
                ))}
            </div>
        </div>
    )
}

export default TaskList;