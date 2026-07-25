const fs = require('fs');
const path = 'src/pages/client/Dashboard.tsx';
let code = fs.readFileSync(path, 'utf8');

// 1. Add states for isCapacitorApp and pushGranted
const stateTarget = `  const [showPwaBanner, setShowPwaBanner] = useState(() => {`;
const stateReplacement = `  const [isCapacitorApp, setIsCapacitorApp] = useState(false);
  const [pushGranted, setPushGranted] = useState(false);

  const [showPwaBanner, setShowPwaBanner] = useState(() => {`;

if (code.includes(stateTarget) && !code.includes('const [isCapacitorApp')) {
  code = code.replace(stateTarget, stateReplacement);
}

// 2. Replace the useEffect for loadData to also include checkPushState
const useEffectTarget = `  useEffect(() => {
    loadData();
    subscribeToPush();
  }, []);`;

const useEffectReplacement = `  useEffect(() => {
    loadData();
    subscribeToPush();
    
    const checkPushState = async () => {
      const isCapacitor = typeof window !== "undefined" && (window as any).Capacitor !== undefined;
      setIsCapacitorApp(isCapacitor);
      if (isCapacitor) {
        const PushNotifications = (window as any).Capacitor.Plugins.PushNotifications;
        if (PushNotifications) {
          const status = await PushNotifications.checkPermissions();
          setPushGranted(status.receive === 'granted');
        }
      } else if ('Notification' in window) {
        setPushGranted(Notification.permission === 'granted');
      }
    };
    checkPushState();
  }, []);`;

if (code.includes(useEffectTarget)) {
  code = code.replace(useEffectTarget, useEffectReplacement);
}

// 3. Replace the button rendering
const buttonTarget = `            {('Notification' in window) && Notification.permission !== 'granted' && (
              <button 
                onClick={() => subscribeToPush()}
                className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-indigo-500 text-white rounded-full hover:bg-indigo-600 transition-colors cursor-pointer"
              >
                Ativar Notificações
              </button>
            )}`;

const buttonReplacement = `            {!pushGranted && (
              <button 
                onClick={() => subscribeToPush().then(() => setPushGranted(true))}
                className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider bg-indigo-500 text-white rounded-full hover:bg-indigo-600 transition-colors cursor-pointer"
              >
                Ativar Notificações
              </button>
            )}`;

if (code.includes(buttonTarget)) {
  code = code.replace(buttonTarget, buttonReplacement);
}

fs.writeFileSync(path, code, 'utf8');
console.log('Dashboard patched successfully');
