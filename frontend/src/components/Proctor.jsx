// src/components/Proctor.jsx
import React, { useRef, useEffect, useState } from "react";
import * as tf from "@tensorflow/tfjs";
import * as cocoSsd from "@tensorflow-models/coco-ssd";
import { FaceMesh } from "@mediapipe/face_mesh";
import { Camera } from "@mediapipe/camera_utils";
import { io } from "socket.io-client";

const BACKEND_BASE = `${process.env.REACT_APP_BACKEND_URL}/api`;
const socket = io(`${process.env.REACT_APP_BACKEND_URL}`, { reconnection: false });

export default function Proctor() {
    const videoRef = useRef(null);
    const canvasRef = useRef(null);
    const mediaRecorderRef = useRef(null);
    const recordedChunksRef = useRef([]);
    const [running, setRunning] = useState(false);
    const [logs, setLogs] = useState([]);
    const cocoModelRef = useRef(null);
    const faceMeshRef = useRef(null);

    const lastFaceSeenRef = useRef(Date.now());
    const lastLookingAtScreenRef = useRef(Date.now());
    const lastMultipleFacesRef = useRef(null);
    const eyeClosedStartRef = useRef(null);
    const sessionStartRef = useRef(null);
    const [candidateName, setCandidateName] = useState('')
    const [candidateId, setCandidateId] = useState()
    const [disableStartBtn, setDisableStartBtn] = useState(false);
    const sessionClosed = useRef(false);

    const LOOK_AWAY_THRESHOLD = 5000;
    const NO_FACE_THRESHOLD = 10000;
    const EYE_CLOSED_THRESHOLD = 2500;

    function randomAlphaNumericWithMilliseconds() {
        const now = Date.now() + new Date().getMilliseconds();

        const chars = "abcdefghijklmnopqrstuvwxyz0123456789";

        let result = "";
        let temp = now;

        for (let i = 0; i < 12; i++) {
            temp = (temp * 9301 + 49297 + i) % 233280;
            const index = temp % chars.length;
            result += chars[index];
        }

        const shuffle = str => str.replace(/\s+/g, '').split('').sort(() => Math.random() - 0.5).join('');

        return shuffle(result);
    }

    function pushEvent(type, details = {}) {
        if (!sessionClosed.current) {
            const ev = {
                candidateId: localStorage.getItem('localCdtId'),
                timestamp: new Date().toISOString(),
                type,
                details,
            };
            setLogs((s) => [ev, ...s]);
            socket.emit("proctor_event", ev)
        } else {
            if (socket.connected) {
                socket.disconnect();
            }
            socket.disconnect();
        }
    }

    async function uploadVideo(blob) {
        const form = new FormData();
        form.append("candidateId", candidateId);
        form.append("candidateName", candidateName);
        form.append("video", blob, `${candidateId}_${Date.now()}.webm`);
        try {
            const res = await fetch(`${BACKEND_BASE}/video`, {
                method: "POST",
                body: form,
            });
            return res.json();
        } catch (err) {
            console.error("Upload failed", err);
        }
    }

    async function uploadLogs() {
        if (!sessionClosed.current) {
            pushEvent("session_end", { duration_ms: Date.now() - sessionStartRef.current });
            sessionClosed.current = true
        }
        socket.disconnect();
    }

    useEffect(() => {
        let camera = null;

        const storedCdtId = `pctr_${randomAlphaNumericWithMilliseconds()}`;
        setCandidateId(storedCdtId)
        localStorage.setItem('localCdtId', storedCdtId)
        async function setup() {
            cocoModelRef.current = await cocoSsd.load();
            const faceMesh = new FaceMesh({
                locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`,
            });
            faceMesh.setOptions({
                maxNumFaces: 2,
                refineLandmarks: true,
                minDetectionConfidence: 0.6,
                minTrackingConfidence: 0.6,
            });
            faceMesh.onResults(onFaceMeshResults);
            faceMeshRef.current = faceMesh;

            const video = videoRef.current;
            camera = new Camera(video, {
                onFrame: async () => {
                    await faceMesh.send({ image: video });
                },
                width: 400,
                height: 300,
            });
            camera.start();

            objectDetectionLoop();
        }

        let objectDetectRunning = true;
        async function objectDetectionLoop() {
            const video = videoRef.current;
            while (objectDetectRunning) {
                if (video && !video.paused && !video.ended && cocoModelRef.current) {
                    try {
                        const predictions = await cocoModelRef.current.detect(video);
                        handleObjectDetections(predictions);
                    } catch (e) {
                        console.error("object detect err", e);
                    }
                }
                await new Promise((r) => setTimeout(r, 800));
            }
        }

        function calculateEAR(lm, eyeIndices) {
            function dist(i, j) {
                return Math.hypot(lm[i].x - lm[j].x, lm[i].y - lm[j].y);
            }
            const vertical1 = dist(eyeIndices[1], eyeIndices[5]);
            const vertical2 = dist(eyeIndices[2], eyeIndices[4]);
            const horizontal = dist(eyeIndices[0], eyeIndices[3]);
            return (vertical1 + vertical2) / (2.0 * horizontal);
        }

        function onFaceMeshResults(results) {
            const multi = results.multiFaceLandmarks || [];
            if (multi.length === 0) {
                const now = Date.now();
                if (now - lastFaceSeenRef.current > NO_FACE_THRESHOLD) {
                    pushEvent("no_face", { duration_ms: now - lastFaceSeenRef.current });
                    lastFaceSeenRef.current = now;
                }
            } else {
                lastFaceSeenRef.current = Date.now();

                if (multi.length > 1) {
                    const now = Date.now();
                    if (!lastMultipleFacesRef.current || now - lastMultipleFacesRef.current > 2000) {
                        pushEvent("multiple_faces", { count: multi.length });
                        lastMultipleFacesRef.current = now;
                    }
                }

                try {
                    const lm = multi[0];

                    const LEFT_EYE = [33, 160, 158, 133, 153, 144];
                    const RIGHT_EYE = [362, 385, 387, 263, 373, 380];
                    const leftEAR = calculateEAR(lm, LEFT_EYE);
                    const rightEAR = calculateEAR(lm, RIGHT_EYE);
                    const avgEAR = (leftEAR + rightEAR) / 2;

                    if (avgEAR < 0.2) {
                        if (!eyeClosedStartRef.current) {
                            eyeClosedStartRef.current = Date.now();
                        } else if (Date.now() - eyeClosedStartRef.current > EYE_CLOSED_THRESHOLD) {
                            pushEvent("drowsiness", { ear: avgEAR, duration_ms: Date.now() - eyeClosedStartRef.current });
                            eyeClosedStartRef.current = null;
                        }
                    } else {
                        eyeClosedStartRef.current = null;
                    }

                    const nose = lm[1] || lm[4] || lm[0];
                    const leftEye = lm[33];
                    const rightEye = lm[263];
                    const eyeCenterX = (leftEye.x + rightEye.x) / 2;
                    const noseX = nose.x;
                    const deviation = Math.abs(noseX - eyeCenterX);
                    if (deviation > 0.06) {
                        const now = Date.now();
                        if (now - lastLookingAtScreenRef.current > LOOK_AWAY_THRESHOLD) {
                            pushEvent("looking_away", { deviation, duration_ms: now - lastLookingAtScreenRef.current });
                            lastLookingAtScreenRef.current = now;
                        }
                    } else {
                        lastLookingAtScreenRef.current = Date.now();
                    }
                } catch {
                    lastLookingAtScreenRef.current = Date.now();
                }
            }
        }

        function handleObjectDetections(predictions) {
            if (!predictions || predictions.length === 0) return;
            const interesting = predictions.filter((p) =>
                ["cell phone", "book", "laptop", "remote", "tv", "keyboard"].includes(p.class)
            );
            interesting.forEach((pred) => {
                if (pred.score > 0.6) {
                    pushEvent("suspicious_item", {
                        item: pred.class,
                        score: pred.score,
                        bbox: pred.bbox,
                    });
                }
            });
        }

        setup().catch(console.error);

        return () => {
            objectDetectRunning = false;
            camera && camera.stop && camera.stop();
        };
    }, []);

    async function startSession() {
        if (candidateName.length) {
            setRunning(true);
            setDisableStartBtn(true);
            recordedChunksRef.current = [];
            const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
            // if (videoRef.current) {
            //     videoRef.current.srcObject = stream;
            //     await videoRef.current.play();
            // }
            const options = { mimeType: "video/webm;codecs=vp9,opus" };
            const recorder = new MediaRecorder(stream, options);
            recorder.ondataavailable = (e) => {
                if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
            };
            recorder.onstop = async () => {
                const blob = new Blob(recordedChunksRef.current, { type: "video/webm" });
                pushEvent("session_end", { duration_ms: Date.now() - sessionStartRef.current });
                await uploadVideo(blob);
            };
            mediaRecorderRef.current = recorder;
            recorder.start(1000);
            sessionStartRef.current = Date.now();
            pushEvent("session_start", {});
        }
    }

    async function stopSession() {
        setDisableStartBtn(false);
        await uploadLogs();
        localStorage.removeItem('localCdtId');
        setCandidateName('')
        setRunning(false);
        if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
            mediaRecorderRef.current.stop();
        }
    }

    function logColor(logType) {
        let logTextClr = "text-blue-600";
        switch (logType) {
            case "multiple_faces":
            case "no_face":
                logTextClr = "text-red-600 font-semibold";
                break;
            case "looking_away":
                logTextClr = "text-yellow-600 font-medium";
                break;
            case "drowsiness":
                logTextClr = "text-orange-600 font-medium";
                break;
            case "session_start":
                logTextClr = "text-green-600 font-bold";
                break;
            case "session_end":
                logTextClr = "text-gray-600 font-medium";
                break;
            case "suspicious_item":
                logTextClr = "text-purple-600 font-medium";
                break;
            case "background_noise":
                logTextClr = "text-purple-600 font-medium";
                break;
            default:
                logTextClr = "text-blue-600";
        }

        return logTextClr;
    }

    return (
        <div className="bg-white rounded-2xl shadow-lg p-4 max-w-4xl mt-6 w-full">
            <div className="flex flex-col md:flex-row gap-6">
                {/* <!-- Left: Video + Controls + Logs --> */}
                <div className="flex-1">
                    <h2 className="text-xl font-semibold mb-2">Interview View — Candidate</h2>
                    <div className="relative w-full max-w-md h-72">
                        <video
                            ref={videoRef}
                            autoPlay
                            playsInline
                            muted
                            className="w-full h-full bg-black rounded"
                        />
                        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
                    </div>

                    {/* <div className="mt-4 flex gap-4">
                        
                    </div> */}

                    {/* Logs */}
                    <div className="mt-4 max-w-lg log-box">
                        <strong className="text-gray-700">Realtime Logs </strong>
                        <ul className="max-h-60 overflow-y-auto text-sm mt-2 bg-gray-50 p-2 rounded shadow-inner w-full">
                            {logs.map((l, i) => {
                                let textColor = logColor(l.type);
                                return (
                                    <li
                                        key={i}
                                        className={`mb-1 px-2 py-1 rounded ${textColor} font-medium hover:bg-gray-100 transition`}
                                    >
                                        [{new Date(l.timestamp).toLocaleTimeString()}] <b>{l.type}</b> — {JSON.stringify(l.details)}
                                    </li>
                                );
                            })}
                        </ul>
                    </div>
                </div>

                {/* Right: Summary */}
                <div className="flex-1">
                    <h3 className="text-lg font-semibold mb-2">Session Summary</h3>
                    <p>Candidate ID: {candidateId}</p>
                    <p>
                        <label>Candidate Name : </label>
                        <input type="text" name="candidateName" value={candidateName} onChange={e => setCandidateName(e.target.value)} placeholder="Full Name" disabled={disableStartBtn} />
                    </p>
                    <div className="flex items-center gap-x-4">
                        {!running ? (
                            <button
                                className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded hover:bg-blue-700 transition disabled:opacity-50"
                                onClick={startSession}
                                disabled={disableStartBtn}
                            >
                                Start Session
                            </button>
                        ) : (
                            <button
                                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded hover:bg-red-800 transition"
                                onClick={stopSession}
                            >
                                Stop Session
                            </button>
                        )}
                    </div>
                    {/* <p>Events logged: {logs.length}</p> */}
                    {/* <button
                        className="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition"
                        onClick={async () => {
                            const res = await fetch(`${BACKEND_BASE}/reports/${candidateId}`);
                            const j = await res.json();
                            alert("Report fetched — check console");
                            console.log("Report:", j);
                        }}
                    >
                        Fetch Report
                    </button> */}
                </div>
            </div>
        </div>
    );
}
