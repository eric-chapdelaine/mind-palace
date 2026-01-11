import Homepage from "./components/homepage";
import { TaskProvider } from "./TaskProvider";
import { ThemeProvider } from '@mui/material/styles';
import theme from './theme';

function App() {
  return (
    <ThemeProvider theme={theme}>
      <TaskProvider>
          <Homepage />
      </TaskProvider>
    </ThemeProvider>
  );
}

export default App;
