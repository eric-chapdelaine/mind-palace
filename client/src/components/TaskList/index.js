import "./index.css";
import TaskCard from "../TaskCard";

const TaskList = ({title, tasks}) => {
    return (
        <div className="task-list">
            <div className="task-list-title">{title}</div>
            {tasks.map((task) => (
                <TaskCard key={task._id} task={task} />
            ))}
        </div>
    )
}

export default TaskList;