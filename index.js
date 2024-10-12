/**
 * @format
 */

import { AppRegistry } from 'react-native';
import App from './src/App';
import { name as appName } from './app.json';
import { Provider as PaperProvider, DefaultTheme } from 'react-native-paper';

export default function Main() {
  const customTheme = {
    ...DefaultTheme,
    colors: {
      ...DefaultTheme.colors,
      primary: 'black', // Change this to your desired focus color
    },
  };
  return (
    <PaperProvider theme={customTheme}>
      <App />
    </PaperProvider>
  );
}

AppRegistry.registerComponent(appName, () => Main);
