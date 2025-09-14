import { useState } from 'react';
import Proctor from './components/Proctor';
import ReportViewer from './components/ReportViewer';
import Dashboard from './components/Dashboard';

function App() {

    const [view, setView] = useState('reports');
    const btnNavActive = (activeNav) => {
        const isActive = activeNav ? true : false;
        const btnClass = isActive ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-100'
        return `px-4 py-2 text-sm font-medium ${btnClass}`
    }

    return (
        <div className="min-h-screen bg-gray-100 py-8">
            <div className="container mx-auto flex flex-col items-center">

                <div className="flex justify-center mb-6">
                    <div className="inline-flex rounded-md shadow-sm" role="group">
                        <button
                            type="button"
                            className={btnNavActive(view === 'proctor')}
                            onClick={() => setView('proctor')}

                        >
                            Start Interview
                        </button>
                        <button
                            type="button"
                            className={btnNavActive(view === 'reports')}
                            onClick={() => setView('reports')}
                        >
                            View Reports
                        </button>

                        <button
                            type="button"
                            className={btnNavActive(view === 'dashboard')}
                            onClick={() => setView('dashboard')}
                        >
                            Dashboard
                        </button>
                    </div>
                </div>

                {view === 'proctor' ? <Proctor /> : null}
                {view === 'reports' ? <ReportViewer /> : null}
                {view === 'dashboard' ? <Dashboard /> : null}
            </div>
        </div>
    );
}

export default App;