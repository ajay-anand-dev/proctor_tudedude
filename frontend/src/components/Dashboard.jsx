import React, { useEffect, useState } from "react";
import { io } from "socket.io-client"; 

const socket = io(process.env.REACT_APP_BACKEND_URL);

export default function Dashboard() {
    const [events, setEvents] = useState([]);

    useEffect(() => {
        const handleProctorEvent = (ev) => {
            setEvents((prev) => [ev, ...prev]);
        };

        // Listen to server events
        socket.on("proctor_event", handleProctorEvent);

        // Cleanup to avoid duplicate listeners
        return () => {
            socket.off("proctor_event", handleProctorEvent);
        };
    }, []);

    function logColor(logType) {
        switch (logType) {
            case "multiple_faces":
            case "no_face":
                return "text-red-600 font-semibold";
            case "looking_away":
                return "text-yellow-600 font-medium";
            case "drowsiness":
                return "text-orange-600 font-medium";
            case "session_start":
                return "text-green-600 font-bold";
            case "session_end":
                return "text-gray-600 font-medium";
            case "suspicious_item":
            case "background_noise":
                return "text-purple-600 font-medium";
            default:
                return "text-blue-600";
        }
    }

    return (
        <div className="bg-white rounded-2xl shadow-lg p-4 max-w-4xl mt-6 w-full">
            <div className="flex flex-col md:flex-row gap-6">
                <div className="flex-1">
                    <div className="mt-4 max-w-lg log-box">
                        <strong className="text-gray-700">Live Proctoring Alerts </strong>
                        <ul className="max-h-60 overflow-y-auto text-sm mt-2 bg-gray-50 p-2 rounded shadow-inner w-full">
                            {events.map((l, i) => (
                                <li
                                    key={i}
                                    className={`mb-1 px-2 py-1 rounded ${logColor(l.type)} font-medium hover:bg-gray-100 transition`}
                                >
                                    [{new Date(l.timestamp).toLocaleTimeString()}] <b>{l.type}</b> — {JSON.stringify(l.details)}
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}
