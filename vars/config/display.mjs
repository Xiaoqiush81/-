return async ({ info: { partType, partName }, data, containers, editors }) => {
	// Common elements
	const blobToBase64 = blob => new Promise((resolve, reject) => {
		const reader = new FileReader()
		reader.onloadend = () => resolve(reader.result)
		reader.onerror = reject
		reader.readAsDataURL(blob)
	})

	const saveFile = async (fileName, blob, statusElement) => {
		const base64Data = await blobToBase64(blob)
		statusElement.textContent = '正在保存...'
		try {
			const response = await fetch(`/api/${partType}/${partName}/saveFile`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filePath: fileName,
					content: base64Data
				}),
			})
			if (!response.ok) {
				const error = await response.json()
				throw new Error(error.message || 'Failed to save file.')
			}
			const result = await response.json()
			statusElement.textContent = `文件已保存: ${fileName}`
			console.log('File saved successfully', result)
			return true
		} catch (error) {
			console.error('Error saving file:', error)
			statusElement.textContent = `保存失败: ${error.message}`
			return false
		}
	}

	const saveRawAudio = async (fileName, audioBuffer, statusElement) => {
		const samples = audioBuffer.getChannelData(0)
		statusElement.textContent = '正在保存...'
		try {
			const response = await fetch(`/api/${partType}/${partName}/saveAudioFile`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					filePath: fileName,
					samples: Array.from(samples),
				}),
			})
			if (!response.ok) {
				const error = await response.json()
				throw new Error(error.message || 'Failed to save audio file.')
			}
			const result = await response.json()
			statusElement.textContent = `文件已保存: ${fileName}`
			console.log('Audio file saved successfully', result)
			return true
		} catch (error) {
			console.error('Error saving audio file:', error)
			statusElement.textContent = `保存失败: ${error.message}`
			return false
		}
	}

	// --- Audio Section ---
	const recordButton = document.getElementById('recordButton')
	const stopButton = document.getElementById('stopButton')
	const recordingStatus = document.getElementById('recordingStatus')
	const audioPlayback = document.getElementById('audioPlayback')
	const audioStatus = document.getElementById('audioStatus')
	let mediaRecorder
	let audioChunks = []

	// --- Photo Section ---
	const photoInput = document.getElementById('photoInput')
	const savePhotoButton = document.getElementById('savePhotoButton')
	const imagePreview = document.getElementById('imagePreview')
	const photoStatus = document.getElementById('photoStatus')
	const uploadStatus = document.getElementById('uploadStatus')
	const cameraButton = document.getElementById('cameraButton')
	const cameraView = document.getElementById('cameraView')
	const videoElement = document.getElementById('videoElement')
	const captureButton = document.getElementById('captureButton')
	let selectedPhotoFile = null
	let videoStream = null

	// --- Initial Load ---
	const loadPreview = async (filePath, element, statusElement, type) => {
		statusElement.textContent = '正在加载预览...'
		try {
			const response = await fetch(`/api/${partType}/${partName}/getFile?filePath=${encodeURIComponent(filePath)}&t=${Date.now()}`)
			if (response.ok) {
				const blob = await response.blob()
				const url = URL.createObjectURL(blob)
				element.src = url
				if (type === 'audio') {
					element.classList.remove('hidden')
					statusElement.textContent = '预览已加载。'
				} else if (type === 'photo') {
					element.classList.add('hidden') // Keep it hidden by default
					statusElement.textContent = '已设置参考照片，点击此处显示/隐藏。'
					statusElement.classList.add('cursor-pointer', 'hover:underline')
					statusElement.onclick = () => element.classList.toggle('hidden')
				} else
					statusElement.textContent = '预览已加载。'

			} else if (response.status === 404) {
				statusElement.textContent = '尚未设置参考文件。'
				if (type === 'photo') {
					statusElement.classList.remove('cursor-pointer', 'hover:underline')
					statusElement.onclick = null
				}
			} else {
				const error = await response.json()
				throw new Error(error.message || `Failed to load ${type}`)
			}
		} catch (error) {
			console.error(`Error loading ${type}:`, error)
			statusElement.textContent = `加载预览失败: ${error.message}`
		}
	}

	loadPreview('vars/master-voice-reference.wav', audioPlayback, audioStatus, 'audio')
	loadPreview('vars/master-photo-reference.png', imagePreview, photoStatus, 'photo')

	// --- Audio Processing ---
	const resampleAudio = async (webmBlob) => {
		try {
			const audioContext = new (window.AudioContext || window.webkitAudioContext)()
			const decodedBuffer = await audioContext.decodeAudioData(await webmBlob.arrayBuffer())
			const targetSampleRate = 16000
			const offlineContext = new OfflineAudioContext(1, decodedBuffer.duration * targetSampleRate, targetSampleRate)
			const source = offlineContext.createBufferSource()
			source.buffer = decodedBuffer
			source.connect(offlineContext.destination)
			source.start(0)
			return await offlineContext.startRendering()
		} catch (error) {
			console.error('Failed to process audio:', error)
			throw new Error('音频处理失败: ' + error.message)
		}
	}

	// --- Audio Logic ---
	recordButton.addEventListener('click', async () => {
		let stream
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true })
			const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' })
			mediaRecorder = recorder // for stopButton to access

			recorder.ondataavailable = event => {
				audioChunks.push(event.data)
			}

			recorder.onstop = async () => {
				recordingStatus.textContent = '处理录音中...'
				try {
					const webmBlob = new Blob(audioChunks, { type: 'audio/webm' })
					if (webmBlob.size === 0) throw new Error('录音产生了一个空文件。')

					const renderedBuffer = await resampleAudio(webmBlob)
					const success = await saveRawAudio('vars/master-voice-reference.wav', renderedBuffer, recordingStatus)

					if (success) {
						loadPreview('vars/master-voice-reference.wav', audioPlayback, audioStatus, 'audio')
						audioStatus.textContent = '新参考音色已保存并加载。'
					}
				} catch (error) {
					console.error('Error processing or saving recording:', error)
					recordingStatus.textContent = `处理失败: ${error.message}`
				} finally {
					audioChunks = []
					stream.getTracks().forEach(track => track.stop())
				}
			}

			audioChunks = []
			recorder.start()
			recordButton.classList.add('hidden')
			stopButton.classList.remove('hidden')
			recordingStatus.textContent = '正在录音...'
		} catch (error) {
			console.error('Error starting recording:', error)
			recordingStatus.textContent = '无法开始录音: ' + error.message
			if (stream)
				stream.getTracks().forEach(track => track.stop())

		}
	})

	stopButton.addEventListener('click', () => {
		if (mediaRecorder && mediaRecorder.state !== 'inactive')
			mediaRecorder.stop()

		recordButton.classList.remove('hidden')
		stopButton.classList.add('hidden')
		recordingStatus.textContent = '录音已停止。'
	})

	// --- Photo Logic ---
	const stopCamera = () => {
		if (videoStream) {
			videoStream.getTracks().forEach(track => track.stop())
			videoStream = null
		}
		cameraView.classList.add('hidden')
	}

	cameraButton.addEventListener('click', async () => {
		if (videoStream) {
			stopCamera()
			return
		}
		try {
			videoStream = await navigator.mediaDevices.getUserMedia({ video: true })
			videoElement.srcObject = videoStream
			cameraView.classList.remove('hidden')
			uploadStatus.textContent = '摄像头已开启。'
		} catch (error) {
			console.error('Error accessing camera:', error)
			uploadStatus.textContent = `无法访问摄像头: ${error.message}`
		}
	})

	captureButton.addEventListener('click', () => {
		const canvas = document.createElement('canvas')
		canvas.width = videoElement.videoWidth
		canvas.height = videoElement.videoHeight
		canvas.getContext('2d').drawImage(videoElement, 0, 0, canvas.width, canvas.height)
		canvas.toBlob(blob => {
			selectedPhotoFile = blob
			const url = URL.createObjectURL(blob)
			imagePreview.src = url
			imagePreview.classList.remove('hidden')
			photoStatus.textContent = '已捕获照片，点击上传以保存。'
			photoStatus.classList.remove('cursor-pointer', 'hover:underline')
			photoStatus.onclick = null
			stopCamera()
		}, 'image/png')
	})

	photoInput.addEventListener('change', () => {
		stopCamera()
		selectedPhotoFile = photoInput.files[0]
		if (selectedPhotoFile) {
			const reader = new FileReader()
			reader.onload = (e) => {
				imagePreview.src = e.target.result
				imagePreview.classList.remove('hidden')
				photoStatus.textContent = '已选择新图片，点击上传以保存。'
				photoStatus.classList.remove('cursor-pointer', 'hover:underline')
				photoStatus.onclick = null
			}
			reader.readAsDataURL(selectedPhotoFile)
		}
	})

	savePhotoButton.addEventListener('click', async () => {
		if (!selectedPhotoFile) {
			uploadStatus.textContent = '请先选择或拍摄一张图片。'
			return
		}
		const success = await saveFile('vars/master-photo-reference.png', selectedPhotoFile, uploadStatus)
		if (success) {
			photoStatus.textContent = '照片已更新。'
			loadPreview('vars/master-photo-reference.png', imagePreview, photoStatus, 'photo')
			selectedPhotoFile = null
			photoInput.value = ''
		}
	})
}
