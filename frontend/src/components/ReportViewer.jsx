import { useState, useRef } from 'react';

export default function ReportViewer() {
    const [interviewId, setInterviewId] = useState('');
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const BACKEND_BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;

    const fetchReport = async () => {
        if (!interviewId) return;

        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${BACKEND_BASE}/reports/${interviewId}`);
            const data = await response.json();

            if (data?.success) {
                if (data.report) {
                    setReport(data.report);
                } else {
                    setReport({});
                    setError(data.message || 'Report not found');
                }
            } else {
                setError(data.message || 'Report not found');
            }
        } catch (err) {
            setError('Failed to fetch report');
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    // const formatDuration = (seconds) => {
    //     const mins = Math.floor(seconds / 60);
    //     const secs = Math.floor(seconds % 60);
    //     return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
    // };

    const deductionScore = (eventName, score) => {
        if (["looking_away", "no_face", "multiple_faces", "drowsiness"].includes(eventName)) {
            return -15;
        } else return score > 0 ? `-${score}` : '0'
    }

    const calculateDuration = (startTime, endTime) => {
        const start = new Date(startTime);
        const end = new Date(endTime);

        // Difference in milliseconds
        let diffMs = end - start;

        // Calculate hours, minutes, seconds
        const hours = Math.floor(diffMs / (1000 * 60 * 60));
        diffMs -= hours * 1000 * 60 * 60;

        const minutes = Math.floor(diffMs / (1000 * 60));
        diffMs -= minutes * 1000 * 60;

        const seconds = Math.floor(diffMs / 1000);

        // Pad with leading zeros
        const hh = String(hours).padStart(2, "0");
        const mm = String(minutes).padStart(2, "0");
        const ss = String(seconds).padStart(2, "0");

        return `${hh} : ${mm} : ${ss}`;
    }

    const reportRef = useRef();

    const downloadPDF = async () => {
        const htmlContent = reportRef.current.outerHTML;

        // console.log(htmlContent)

        const response = await fetch(`${BACKEND_BASE}/generate-pdf`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ html: htmlContent }),
        });

        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = `report_${interviewId}.pdf`;
        a.click();
        window.URL.revokeObjectURL(url);
    };

    return (
        <div className="bg-white rounded-2xl shadow-lg p-4 max-w-4xl mt-6 w-full">

            <div className="flex flex-col md:flex-row md:items-center gap-4">
                <h1 className="text-2xl font-bold w-full">Proctoring Report Viewer</h1>

                <input
                    id="interviewId"
                    type="text"
                    value={interviewId}
                    onChange={(e) => setInterviewId(e.target.value)}
                    className="shadow appearance-none border rounded-l py-2 px-3 text-gray-700 leading-tight focus:outline-none focus:shadow-outline"
                    placeholder="Enter interview ID"
                />

                <button
                    id="reportBtn"
                    onClick={fetchReport}
                    disabled={loading || !interviewId}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded-r disabled:bg-gray-400"
                >
                    View Report
                </button>

            </div>

            {report !== null ? (
                <div className="bg-white shadow-md rounded p-6">
                    <div className="flex justify-between items-center mb-6 score-pdf">
                        <div className="text-lg font-semibold">
                            Integrity Score: <span className={report?.integrityScore >= 70 ? 'text-green-600' : report?.integrityScore >= 40 ? 'text-yellow-600' : 'text-red-600'}>
                                {report?.integrityScore}%
                            </span>
                        </div>

                        <button
                            onClick={downloadPDF}
                            className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-4 rounded"
                        >
                            Download PDF
                        </button>
                    </div>

                    <div ref={reportRef}>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                            <div>
                                <h3 className="font-semibold mb-2">Candidate Information</h3>
                                <p><span className="font-medium">Name:</span> {report?.candidateName}</p>
                                <p><span className="font-medium">Interview ID:</span> {report?.candidateId}</p>
                                <p><span className="font-medium">Start Time:</span> {new Date(report?.startTime).toLocaleString()}</p>
                                <p><span className="font-medium">End Time:</span> {new Date(report?.endTime).toLocaleString()}</p>
                                <p><span className="font-medium">Duration:</span> {calculateDuration(report?.startTime, report?.endTime)}</p>
                            </div>

                            <div>
                                <h3 className="font-semibold mb-2">Summary Statistics</h3>
                                <p><span className="font-medium">Focus Lost:</span> {report?.focusLostCount} times</p>
                                <p><span className="font-medium">No Face Detected:</span> {report?.noFaceCount} times</p>
                                <p><span className="font-medium">Multiple Faces:</span> {report?.multipleFacesCount} times</p>
                                <p><span className="font-medium">Suspicious Objects:</span> {Object?.values(report?.suspiciousItems || {})?.length} times</p>
                                <p><span className="font-medium">Audio Events:</span> {report?.audioEventsCount || 0} times</p>
                            </div>
                        </div>

                        <div className="mb-6">
                            <h3 className="font-semibold mb-2">Event Log</h3>
                            <div className="max-h-60 overflow-y-auto border rounded">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Time</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Event</th>
                                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Deduction</th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {report?.rawLogs?.map((event, index) => {
                                            return (
                                                <tr key={index}>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                        {new Date(event?.timestamp).toLocaleTimeString()}
                                                    </td>
                                                    <td className="px-6 py-4 text-sm text-gray-900">
                                                        {event?.details?.item || event?.type}
                                                    </td>
                                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                                        {deductionScore(event?.details?.item || event?.type, event?.deduction)}
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>

                    {/* {report.videoPath && (
                        <div>
                            <h3 className="font-semibold mb-2">Interview Recording</h3>
                            <video
                                src={`http://localhost:4000/${report.videoPath}`}
                                controls
                                className="w-full max-w-lg"
                            />
                        </div>
                    )} */}
                </div>
            ) : error ?
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
                    No candidate found
                </div> : null
            }
        </div >
    );
}