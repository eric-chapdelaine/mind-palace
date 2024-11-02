import Homepage from "./components/homepage";
import { TaskProvider } from "./TaskProvider";

function App() {
  return (
    <TaskProvider>
        <Homepage />
    </TaskProvider>
  );
}

export default App;
