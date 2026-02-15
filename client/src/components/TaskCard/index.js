import "./index.css";
import TaskModal from "../TaskModal"
import { formatDate } from "../../utils";
import { getTagName } from "../../services/tag";
import { useEffect, useState } from "react";
import { updateTask } from "../../services/task";
import { useTasks } from "../../TaskProvider";

const TaskCard = ({task}) => {

  const { refreshTasks } = useTasks();

  const [tags, setTags] = useState([]);
  const [open, setOpen] = useState(false);


  useEffect(() => {
    const fetchTags = async () => {

      try {
        const tagNames = await Promise.all(task.tags.map(tag => getTagName(tag)));
        setTags(tagNames || []);
      } catch (error) {
        // TODO: Figure out what to do with errors
      }
    };

    fetchTags();

  }, [task.tags]);

  return (
    <>
      <TaskModal 
        task={task} 
        open={open} 
        onClose={() => {setOpen(false)}} />
      <div className="task-card" onClick={() => {setOpen(true)}}>
        <h3 className="task-title">{task.title}</h3>
        <p className="due-date">{formatDate(task.due_date)}</p>

        <div className="tags">
          {tags.map((tag, index) => (
            <span key={index} className="tag">{tag}</span>
          ))}
        </div>

        <label className="checkbox-label"
          onClick={async (e) => {
            e.stopPropagation();
            await updateTask(task._id, {is_completed: !task.is_completed});
            await refreshTasks();
          }}>
          <input
            type="checkbox"
            checked={task.is_completed}
            readOnly
          />
          Completed
        </label>
      </div>
    </>
  );
}

export default TaskCard
