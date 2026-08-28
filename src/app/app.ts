import { CommonModule } from '@angular/common';
import {
  Component,
  ElementRef,
  OnInit,
  ViewChild
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import * as L from 'leaflet';

interface MemoryLocation {
  latitude: number;
  longitude: number;
}

interface Memory {
  id: string;
  title: string;
  date: string;
  location: string;
  category: string;
  emotion: string;
  people: string;
  description: string;
  photos: string[];
  videoNames: string[];
  reminder: string;
  coordinates?: MemoryLocation;
  audioUrl?: string;
  soundscapeUrl?: string;
}

type Page =
  | 'home'
  | 'memories'
  | 'create'
  | 'timeline'
  | 'map'
  | 'settings';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App implements OnInit {
  readonly apiUrl = 'http://localhost:3000/api';
  authChecked = false;
  authLoading = false;
  authMode: 'login' | 'register' = 'login';
  authError = '';
  currentUser: { id: string; name: string; email: string; createdAt?: string } | null = null;
  loginForm = { email: '', password: '' };
  registerForm = { name: '', email: '', password: '', passwordConfirmation: '' };

  activePage: Page = 'home';

  searchText = '';
  selectedCategory = 'Alle';
  selectedTimelineYear = 'Alle';
  selectedTimelineMemory: Memory | null = null;

settings = {
  remindersEnabled: true,
  defaultReminder: 'In einem Monat',
  autoplaySoundscape: false,
  compactTimeline: false,
  language: 'Deutsch',
  profileName: 'Daria'
};

settingsSaved = false;

  categories = [
    'Alle',
    'Konzert',
    'Festival',
    'Museum',
    'Ausstellung',
    'Theater',
    'Kulturelle Reise',
    'Andere'
  ];

  creationCategories = [
    'Konzert',
    'Festival',
    'Museum',
    'Ausstellung',
    'Theater',
    'Kulturelle Reise',
    'Andere'
  ];

  emotions = [
    'Freude',
    'Inspiration',
    'Ruhe',
    'Freiheit',
    'Nostalgie',
    'Überraschung',
    'Nähe',
    'Begeisterung'
  ];

  reminders = [
    'Keine Erinnerung',
    'In einem Monat',
    'In sechs Monaten',
    'In einem Jahr',
    'Am Jahrestag'
  ];

  memories: Memory[] = [];

  newMemory = {
    title: '',
    date: '',
    location: '',
    category: 'Konzert',
    emotion: 'Freude',
    people: '',
    description: '',
    reminder: 'In einem Monat'
  };

  photoPreviews: string[] = [];
  videoNames: string[] = [];
  private selectedPhotoFiles: File[] = [];
  private selectedVideoFiles: File[] = [];
  private soundscapeBlob?: Blob;

  isRecording = false;
  isCreatingSoundscape = false;
  recordingSeconds = 0;

  recordedAudioUrl = '';
  soundscapeUrl = '';

  private recordedAudioBlob?: Blob;
  private mediaRecorder?: MediaRecorder;
  private mediaStream?: MediaStream;
  private audioChunks: Blob[] = [];
  private recordingTimer?: ReturnType<typeof setInterval>;

  private map?: L.Map;
  private markerLayer?: L.LayerGroup;

  @ViewChild('memoryMap')
  set memoryMapElement(
    element: ElementRef<HTMLDivElement> | undefined
  ) {
    if (!element) {
      return;
    }

    window.setTimeout(() => {
      this.createMap(element.nativeElement);
    });
  }
  async ngOnInit(): Promise<void> {
    await this.checkAuthentication();
  }

  async checkAuthentication(): Promise<void> {
    try {
      const response = await fetch(`${this.apiUrl}/auth/me`, { credentials: 'include' });
      if (!response.ok) {
        this.currentUser = null;
        return;
      }
      const data = await response.json();
      this.currentUser = data.user;
      await Promise.all([this.loadMemories(), this.loadSettings()]);
    } catch {
      this.authError = 'Backend nicht erreichbar. Bitte starte zuerst den Backend-Server.';
    } finally {
      this.authChecked = true;
    }
  }

  async submitAuth(): Promise<void> {
    this.authError = '';
    this.authLoading = true;
    try {
      const isRegister = this.authMode === 'register';
      if (isRegister && this.registerForm.password !== this.registerForm.passwordConfirmation) {
        this.authError = 'Die Passwörter stimmen nicht überein.';
        return;
      }
      const body = isRegister
        ? { name: this.registerForm.name, email: this.registerForm.email, password: this.registerForm.password }
        : this.loginForm;
      const response = await fetch(`${this.apiUrl}/auth/${isRegister ? 'register' : 'login'}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Anmeldung fehlgeschlagen.');
      this.currentUser = data.user;
      this.settings.profileName = data.user.name;
      await Promise.all([this.loadMemories(), this.loadSettings()]);
      this.activePage = 'home';
    } catch (error) {
      this.authError = error instanceof Error ? error.message : 'Anmeldung fehlgeschlagen.';
    } finally {
      this.authLoading = false;
    }
  }

  async logout(): Promise<void> {
    await fetch(`${this.apiUrl}/auth/logout`, { method: 'POST', credentials: 'include' });
    this.currentUser = null;
    this.memories = [];
    this.selectedTimelineMemory = null;
    this.authMode = 'login';
    this.loginForm.password = '';
  }

  private async loadMemories(): Promise<void> {
    const response = await fetch(`${this.apiUrl}/memories`, { credentials: 'include' });
    if (!response.ok) return;
    const data = await response.json();
    this.memories = data.memories;
    this.refreshMapMarkers();
  }

  private async loadSettings(): Promise<void> {
    const response = await fetch(`${this.apiUrl}/settings`, { credentials: 'include' });
    if (!response.ok) return;
    const data = await response.json();
    this.settings = { ...this.settings, ...data.settings };
  }

openTimelineMemory(memory: Memory): void {
  this.selectedTimelineMemory = memory;
}

closeTimelineMemory(): void {
  this.selectedTimelineMemory = null;
}

async saveSettings(): Promise<void> {
  const response = await fetch(`${this.apiUrl}/settings`, {
    method: 'PUT', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.settings)
  });
  if (!response.ok) {
    alert('Die Einstellungen konnten nicht gespeichert werden.');
    return;
  }
  const data = await response.json();
  this.settings = { ...this.settings, ...data.settings };
  if (data.user) this.currentUser = data.user;
  this.settingsSaved = true;
  window.setTimeout(() => { this.settingsSaved = false; }, 2500);
}

resetSettings(): void {
  this.settings = {
    remindersEnabled: true,
    defaultReminder: 'In einem Monat',
    autoplaySoundscape: false,
    compactTimeline: false,
    language: 'Deutsch',
    profileName: this.currentUser?.name || 'Memoria'
  };

  this.settingsSaved = true;

  window.setTimeout(() => {
    this.settingsSaved = false;
  }, 2500);
}

  get totalPhotoCount(): number {
    return this.memories.reduce((total, memory) => total + (memory.photos?.length || 0), 0);
  }

  get totalSoundtrackCount(): number {
    return this.memories.filter((memory) => Boolean(memory.soundscapeUrl || memory.audioUrl)).length;
  }

  get filteredMemories(): Memory[] {
    const search = this.searchText.trim().toLowerCase();

    return this.memories.filter((memory) => {
      const categoryMatches =
        this.selectedCategory === 'Alle' ||
        memory.category === this.selectedCategory;

      const searchMatches =
        !search ||
        memory.title.toLowerCase().includes(search) ||
        memory.location.toLowerCase().includes(search) ||
        memory.people.toLowerCase().includes(search) ||
        memory.description.toLowerCase().includes(search);

      return categoryMatches && searchMatches;
    });
  }

  get timelineYears(): number[] {
    return [
      ...new Set(
        this.memories.map((memory) =>
          new Date(memory.date).getFullYear()
        )
      )
    ].sort((a, b) => b - a);
  }

  get timelineMemories(): Memory[] {
    const memories = [...this.memories].sort(
      (a, b) =>
        new Date(b.date).getTime() -
        new Date(a.date).getTime()
    );

    if (this.selectedTimelineYear === 'Alle') {
      return memories;
    }

    return memories.filter(
      (memory) =>
        new Date(memory.date).getFullYear().toString() ===
        this.selectedTimelineYear
    );
  }

  async openPage(page: Page): Promise<void> {
  this.activePage = page;
  this.selectedTimelineMemory = null;

  window.scrollTo({
    top: 0,
    behavior: 'smooth'
  });

  if (page === 'map') {
    await this.prepareMapMemories();

    window.setTimeout(() => {
      this.map?.invalidateSize();
      this.refreshMapMarkers();
    }, 350);
  }
}

  getFormattedDate(date: string): string {
    if (!date) {
      return '';
    }

    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(new Date(date));
  }

  getTimelineYear(memory: Memory): number {
    return new Date(memory.date).getFullYear();
  }

  getTimelineDay(memory: Memory): string {
    return new Intl.DateTimeFormat('de-DE', {
      day: '2-digit'
    }).format(new Date(memory.date));
  }

  getTimelineMonth(memory: Memory): string {
    return new Intl.DateTimeFormat('de-DE', {
      month: 'short'
    }).format(new Date(memory.date));
  }

  onPhotosSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const remaining = 5 - this.photoPreviews.length;

    files.slice(0, remaining).forEach((file) => {
      if (file.type.startsWith('image/')) {
        this.selectedPhotoFiles.push(file);
        this.photoPreviews.push(URL.createObjectURL(file));
      }
    });

    input.value = '';
  }

  removePhoto(index: number): void {
    const url = this.photoPreviews[index];

    if (url) {
      URL.revokeObjectURL(url);
    }

    this.photoPreviews.splice(index, 1);
    this.selectedPhotoFiles.splice(index, 1);
  }

  onVideosSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    const remaining = 2 - this.videoNames.length;

    files.slice(0, remaining).forEach((file) => {
      if (file.type.startsWith('video/')) {
        this.selectedVideoFiles.push(file);
        this.videoNames.push(file.name);
      }
    });

    input.value = '';
  }

  removeVideo(index: number): void {
    this.videoNames.splice(index, 1);
    this.selectedVideoFiles.splice(index, 1);
  }

  async startRecording(): Promise<void> {
    try {
      this.mediaStream =
        await navigator.mediaDevices.getUserMedia({
          audio: true
        });

      this.audioChunks = [];
      this.recordingSeconds = 0;
      this.recordedAudioUrl = '';
      this.soundscapeUrl = '';

      this.mediaRecorder = new MediaRecorder(this.mediaStream);

      this.mediaRecorder.ondataavailable = (
        event: BlobEvent
      ) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this.recordedAudioBlob = new Blob(
          this.audioChunks,
          {
            type:
              this.mediaRecorder?.mimeType ||
              'audio/webm'
          }
        );

        this.recordedAudioUrl = URL.createObjectURL(
          this.recordedAudioBlob
        );

        this.mediaStream
          ?.getTracks()
          .forEach((track) => track.stop());
      };

      this.mediaRecorder.start(1000);
      this.isRecording = true;

      this.recordingTimer = setInterval(() => {
        this.recordingSeconds++;

        // Для прототипа ограничиваем запись одним часом.
        if (this.recordingSeconds >= 3600) {
          this.stopRecording();
        }
      }, 1000);
    } catch {
      alert(
        'Der Zugriff auf das Mikrofon wurde nicht erlaubt.'
      );
    }
  }

  stopRecording(): void {
    if (!this.mediaRecorder || !this.isRecording) {
      return;
    }

    this.mediaRecorder.stop();
    this.isRecording = false;

    if (this.recordingTimer) {
      clearInterval(this.recordingTimer);
    }
  }

  deleteRecording(): void {
    if (this.recordedAudioUrl) {
      URL.revokeObjectURL(this.recordedAudioUrl);
    }

    if (this.soundscapeUrl) {
      URL.revokeObjectURL(this.soundscapeUrl);
    }

    this.recordedAudioBlob = undefined;
    this.soundscapeBlob = undefined;
    this.recordedAudioUrl = '';
    this.soundscapeUrl = '';
    this.recordingSeconds = 0;
  }

  formatDuration(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;

    if (hours > 0) {
      return [
        hours,
        minutes.toString().padStart(2, '0'),
        remainingSeconds.toString().padStart(2, '0')
      ].join(':');
    }

    return [
      minutes.toString().padStart(2, '0'),
      remainingSeconds.toString().padStart(2, '0')
    ].join(':');
  }

  async createTwoMinuteSoundscape(): Promise<void> {
    if (!this.recordedAudioBlob) {
      alert('Bitte nimm zuerst eine Atmosphäre auf.');
      return;
    }

    this.isCreatingSoundscape = true;

    try {
      const inputArrayBuffer =
        await this.recordedAudioBlob.arrayBuffer();

      const audioContext = new AudioContext();
      const sourceBuffer =
        await audioContext.decodeAudioData(inputArrayBuffer);

      const targetDuration = Math.min(
        120,
        sourceBuffer.duration
      );

      const targetLength = Math.floor(
        targetDuration * sourceBuffer.sampleRate
      );

      const outputBuffer = audioContext.createBuffer(
        sourceBuffer.numberOfChannels,
        targetLength,
        sourceBuffer.sampleRate
      );

      const segmentCount =
        sourceBuffer.duration > 120 ? 3 : 1;

      const segmentDuration =
        targetDuration / segmentCount;

      const sourceStarts =
        segmentCount === 3
          ? [
              0,
              Math.max(
                0,
                sourceBuffer.duration / 2 -
                  segmentDuration / 2
              ),
              Math.max(
                0,
                sourceBuffer.duration -
                  segmentDuration
              )
            ]
          : [0];

      for (
        let channel = 0;
        channel < sourceBuffer.numberOfChannels;
        channel++
      ) {
        const sourceData =
          sourceBuffer.getChannelData(channel);

        const outputData =
          outputBuffer.getChannelData(channel);

        sourceStarts.forEach(
          (sourceStartSeconds, segmentIndex) => {
            const sourceStart = Math.floor(
              sourceStartSeconds *
                sourceBuffer.sampleRate
            );

            const outputStart = Math.floor(
              segmentIndex *
                segmentDuration *
                sourceBuffer.sampleRate
            );

            const frames = Math.min(
              Math.floor(
                segmentDuration *
                  sourceBuffer.sampleRate
              ),
              sourceData.length - sourceStart,
              outputData.length - outputStart
            );

            const fadeFrames = Math.min(
              Math.floor(
                sourceBuffer.sampleRate * 1.5
              ),
              Math.floor(frames / 3)
            );

            for (let frame = 0; frame < frames; frame++) {
              let volume = 1;

              if (frame < fadeFrames) {
                volume = frame / fadeFrames;
              }

              if (frame > frames - fadeFrames) {
                volume =
                  (frames - frame) / fadeFrames;
              }

              outputData[outputStart + frame] =
                sourceData[sourceStart + frame] *
                Math.max(0, Math.min(1, volume));
            }
          }
        );
      }

      const wavBlob =
        this.audioBufferToWav(outputBuffer);
      this.soundscapeBlob = wavBlob;

      if (this.soundscapeUrl) {
        URL.revokeObjectURL(this.soundscapeUrl);
      }

      this.soundscapeUrl =
        URL.createObjectURL(wavBlob);

      await audioContext.close();
    } catch {
      alert(
        'Der Soundscape konnte in diesem Browser nicht erstellt werden.'
      );
    } finally {
      this.isCreatingSoundscape = false;
    }
  }

  async saveMemory(): Promise<void> {
    if (!this.newMemory.title.trim() || !this.newMemory.date || !this.newMemory.location.trim() || !this.newMemory.description.trim()) {
      alert('Bitte fülle Titel, Datum, Ort und persönliche Erinnerung aus.');
      return;
    }
    const coordinates = await this.geocodeLocation(this.newMemory.location);
    const formData = new FormData();
    Object.entries(this.newMemory).forEach(([key, value]) => formData.append(key, String(value)));
    if (coordinates) {
      formData.append('latitude', String(coordinates.latitude));
      formData.append('longitude', String(coordinates.longitude));
    }
    this.selectedPhotoFiles.forEach((file) => formData.append('photos', file));
    this.selectedVideoFiles.forEach((file) => formData.append('videos', file));
    if (this.recordedAudioBlob) formData.append('originalAudio', this.recordedAudioBlob, 'aufnahme.webm');
    if (this.soundscapeBlob) formData.append('soundscape', this.soundscapeBlob, 'soundscape.wav');
    const response = await fetch(`${this.apiUrl}/memories`, { method: 'POST', credentials: 'include', body: formData });
    const data = await response.json();
    if (!response.ok) {
      alert(data.message || 'Die Erinnerung konnte nicht gespeichert werden.');
      return;
    }
    this.memories.unshift(data.memory);
    this.resetForm();
    await this.openPage('memories');
  }

  async deleteMemory(id: string): Promise<void> {
    const response = await fetch(`${this.apiUrl}/memories/${id}`, { method: 'DELETE', credentials: 'include' });
    if (!response.ok) return;
    this.memories = this.memories.filter((memory) => memory.id !== id);
    this.refreshMapMarkers();
  }

  resetForm(): void {
    this.newMemory = {
      title: '',
      date: '',
      location: '',
      category: 'Konzert',
      emotion: 'Freude',
      people: '',
      description: '',
      reminder: 'In einem Monat'
    };

    this.photoPreviews = [];
    this.videoNames = [];
    this.selectedPhotoFiles = [];
    this.selectedVideoFiles = [];
    this.soundscapeBlob = undefined;

    this.recordedAudioBlob = undefined;
    this.recordedAudioUrl = '';
    this.soundscapeUrl = '';
    this.recordingSeconds = 0;
  }

  private createMap(container: HTMLDivElement): void {
    if (this.map) {
      this.map.remove();
    }

    this.map = L.map(container, {
      zoomControl: true,
      attributionControl: true
    }).setView([51.1657, 10.4515], 6);

    L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        maxZoom: 19,
        attribution:
          '&copy; OpenStreetMap contributors'
      }
    ).addTo(this.map);

    this.markerLayer = L.layerGroup().addTo(this.map);

    this.refreshMapMarkers();

    window.setTimeout(() => {
      this.map?.invalidateSize();
    }, 200);
  }

  private refreshMapMarkers(): void {
    if (!this.map || !this.markerLayer) {
      return;
    }

    this.markerLayer.clearLayers();

    const memoriesWithCoordinates =
      this.memories.filter(
        (
          memory
        ): memory is Memory & {
          coordinates: MemoryLocation;
        } => Boolean(memory.coordinates)
      );

    const bounds: L.LatLngExpression[] = [];

    memoriesWithCoordinates.forEach((memory) => {
      const position: L.LatLngExpression = [
        memory.coordinates.latitude,
        memory.coordinates.longitude
      ];

      bounds.push(position);

      const markerIcon = L.divIcon({
        className: 'memoria-map-marker-wrapper',
        html: `
          <div class="memoria-map-marker">
            <span>${memory.category
              .charAt(0)
              .toUpperCase()}</span>
          </div>
        `,
        iconSize: [44, 52],
        iconAnchor: [22, 48],
        popupAnchor: [0, -46]
      });

      L.marker(position, {
        icon: markerIcon
      })
        .addTo(this.markerLayer!)
        .bindPopup(`
          <div class="memory-map-popup">
            <small>${this.escapeHtml(
              memory.category
            )}</small>
            <strong>${this.escapeHtml(
              memory.title
            )}</strong>
            <span>${this.escapeHtml(
              memory.location
            )}</span>
            <p>${this.escapeHtml(
              memory.description
            )}</p>
          </div>
        `);
    });

    if (bounds.length === 1) {
      this.map.setView(bounds[0], 11);
    }

    if (bounds.length > 1) {
      this.map.fitBounds(
        L.latLngBounds(bounds),
        {
          padding: [70, 70],
          maxZoom: 10
        }
      );
    }

    if (bounds.length === 0) {
      this.map.setView([51.1657, 10.4515], 6);
    }
  }
  private async prepareMapMemories(): Promise<void> {
  for (const memory of this.memories) {
    if (!memory.coordinates && memory.location.trim()) {
      memory.coordinates = await this.geocodeLocation(
        memory.location
      );

      // Небольшая пауза между запросами геокодирования.
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 1100);
      });
    }
  }
}
  private async geocodeLocation(
    location: string
  ): Promise<MemoryLocation | undefined> {
    const key =
      `memoria-geocode-${location
        .trim()
        .toLowerCase()}`;

    const cached = localStorage.getItem(key);

    if (cached) {
      return JSON.parse(cached) as MemoryLocation;
    }

    try {
      const url =
        'https://nominatim.openstreetmap.org/search' +
        `?format=jsonv2&limit=1&q=${encodeURIComponent(
          location
        )}`;

      const response = await fetch(url, {
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        return undefined;
      }

      const results = (await response.json()) as Array<{
        lat: string;
        lon: string;
      }>;

      if (!results.length) {
        return undefined;
      }

      const coordinates: MemoryLocation = {
        latitude: Number(results[0].lat),
        longitude: Number(results[0].lon)
      };

      localStorage.setItem(
        key,
        JSON.stringify(coordinates)
      );

      return coordinates;
    } catch {
      return undefined;
    }
  }

  private audioBufferToWav(
    buffer: AudioBuffer
  ): Blob {
    const channelCount = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2;
    const blockAlign =
      channelCount * bytesPerSample;

    const dataLength =
      buffer.length * blockAlign;

    const arrayBuffer =
      new ArrayBuffer(44 + dataLength);

    const view = new DataView(arrayBuffer);

    const writeString = (
      offset: number,
      value: string
    ): void => {
      for (let i = 0; i < value.length; i++) {
        view.setUint8(
          offset + i,
          value.charCodeAt(i)
        );
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(
      4,
      36 + dataLength,
      true
    );
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(
      22,
      channelCount,
      true
    );
    view.setUint32(
      24,
      sampleRate,
      true
    );
    view.setUint32(
      28,
      sampleRate * blockAlign,
      true
    );
    view.setUint16(
      32,
      blockAlign,
      true
    );
    view.setUint16(34, 16, true);
    writeString(36, 'data');
    view.setUint32(
      40,
      dataLength,
      true
    );

    const channels = Array.from(
      { length: channelCount },
      (_, channel) =>
        buffer.getChannelData(channel)
    );

    let offset = 44;

    for (
      let frame = 0;
      frame < buffer.length;
      frame++
    ) {
      for (
        let channel = 0;
        channel < channelCount;
        channel++
      ) {
        const sample = Math.max(
          -1,
          Math.min(1, channels[channel][frame])
        );

        view.setInt16(
          offset,
          sample < 0
            ? sample * 0x8000
            : sample * 0x7fff,
          true
        );

        offset += 2;
      }
    }

    return new Blob([arrayBuffer], {
      type: 'audio/wav'
    });
  }

  private escapeHtml(value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }
}