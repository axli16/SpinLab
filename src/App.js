import React, { useRef, useEffect, useState, useCallback } from 'react';
import * as THREE from 'three';

export const MorphingGLBScene = () => {
  const canvasRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const meshRef = useRef(null);
  const [currentShape, setCurrentShape] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const modelDataRef = useRef([]);
  const scrollModelRef = useRef(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState('home');

  // GLTFLoader equivalent using fetch and manual parsing
  const loadGLB = async (url) => {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();

      const dataView = new DataView(arrayBuffer);

      const magic = dataView.getUint32(0, true);
      if (magic !== 0x46546C67) {
        throw new Error('Not a valid GLB file');
      }

      const jsonChunkLength = dataView.getUint32(12, true);
      const jsonChunkType = dataView.getUint32(16, true);

      if (jsonChunkType !== 0x4E4F534A) {
        throw new Error('Invalid GLB format');
      }

      const jsonData = new Uint8Array(arrayBuffer, 20, jsonChunkLength);
      const gltf = JSON.parse(new TextDecoder().decode(jsonData));

      const binaryChunkLength = dataView.getUint32(20 + jsonChunkLength, true);
      const binaryData = new Uint8Array(arrayBuffer, 28 + jsonChunkLength, binaryChunkLength);

      const meshes = [];

      if (gltf.meshes && gltf.meshes.length > 0) {
        for (const mesh of gltf.meshes) {
          for (const primitive of mesh.primitives) {
            const posAccessor = gltf.accessors[primitive.attributes.POSITION];
            const posBufferView = gltf.bufferViews[posAccessor.bufferView];

            const count = posAccessor.count;
            const byteOffset = (posBufferView.byteOffset || 0) + (posAccessor.byteOffset || 0);

            const posData = new Float32Array(
              binaryData.buffer,
              binaryData.byteOffset + byteOffset,
              count * 3
            );

            let indices = null;
            if (primitive.indices !== undefined) {
              const indAccessor = gltf.accessors[primitive.indices];
              const indBufferView = gltf.bufferViews[indAccessor.bufferView];
              const indByteOffset = (indBufferView.byteOffset || 0) + (indAccessor.byteOffset || 0);

              if (indAccessor.componentType === 5123) {
                indices = new Uint16Array(
                  binaryData.buffer,
                  binaryData.byteOffset + indByteOffset,
                  indAccessor.count
                );
              } else if (indAccessor.componentType === 5125) {
                indices = new Uint32Array(
                  binaryData.buffer,
                  binaryData.byteOffset + indByteOffset,
                  indAccessor.count
                );
              }
            }

            meshes.push({ positions: posData, indices });
          }
        }
      }

      return meshes;
    } catch (err) {
      console.error('Error loading GLB:', err);
      throw err;
    }
  };

  // Normalize and center geometry
  const normalizeGeometry = (positions, size) => {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;

    for (let i = 0; i < positions.length; i += 3) {
      minX = Math.min(minX, positions[i]);
      maxX = Math.max(maxX, positions[i]);
      minY = Math.min(minY, positions[i + 1]);
      maxY = Math.max(maxY, positions[i + 1]);
      minZ = Math.min(minZ, positions[i + 2]);
      maxZ = Math.max(maxZ, positions[i + 2]);
    }

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const centerZ = (minZ + maxZ) / 2;
    const scale = Math.max(maxX - minX, maxY - minY, maxZ - minZ);

    const normalized = new Float32Array(positions.length);
    for (let i = 0; i < positions.length; i += 3) {
      normalized[i] = ((positions[i] - centerX) / scale) * size;
      normalized[i + 1] = ((positions[i + 1] - centerY) / scale) * size;
      normalized[i + 2] = ((positions[i + 2] - centerZ) / scale) * size;
    }

    return normalized;
  };

  // Expand models to match the maximum vertex count
  const expandToMaxVertices = (models) => {
    const maxVertices = Math.max(...models.map(m => m.positions.length / 3));

    return models.map(model => {
      const currentCount = model.positions.length / 3;

      if (currentCount === maxVertices) {
        return { ...model, vertexCount: currentCount };
      }

      const expandedPositions = new Float32Array(maxVertices * 3);

      for (let i = 0; i < currentCount; i++) {
        const srcIdx = i * 3;
        expandedPositions[srcIdx] = model.positions[srcIdx];
        expandedPositions[srcIdx + 1] = model.positions[srcIdx + 1];
        expandedPositions[srcIdx + 2] = model.positions[srcIdx + 2];
      }

      for (let i = currentCount; i < maxVertices; i++) {
        const targetIdx = (i % currentCount) * 3;
        const dstIdx = i * 3;
        expandedPositions[dstIdx] = model.positions[targetIdx];
        expandedPositions[dstIdx + 1] = model.positions[targetIdx + 1];
        expandedPositions[dstIdx + 2] = model.positions[targetIdx + 2];
      }

      return { positions: expandedPositions, vertexCount: currentCount };
    });
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let animationId;
    let scene, camera, renderer, mesh;

    const init = async () => {
      try {
        // Setup scene
        scene = new THREE.Scene();
        // No background — transparent canvas
        sceneRef.current = scene;

        // Setup camera
        camera = new THREE.PerspectiveCamera(
          75,
          window.innerWidth / window.innerHeight,
          0.1,
          1000
        );
        camera.position.z = 3;
        cameraRef.current = camera;

        // Setup renderer with alpha for transparency
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setClearColor(0x000000, 0); // transparent clear
        rendererRef.current = renderer;

        // Add lighting
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
        scene.add(ambientLight);

        const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
        directionalLight.position.set(5, 5, 5);
        scene.add(directionalLight);

        const directionalLight2 = new THREE.DirectionalLight(0xcccccc, 0.4);
        directionalLight2.position.set(-5, -5, -5);
        scene.add(directionalLight2);

        // Create floating glass shards
        const shardGroup = new THREE.Group();
        const shardCount = 20;
        const shardMeshes = [];

        for (let i = 0; i < shardCount; i++) {
          const size = Math.random() * 0.8 + 0.3;
          const vertices = new Float32Array([
            0, size, 0,
            -size * 0.8 + Math.random() * 0.2, -size * 0.6, Math.random() * 0.2,
            size * 0.8 + Math.random() * 0.2, -size * 0.5, Math.random() * 0.2
          ]);

          const shardGeometry = new THREE.BufferGeometry();
          shardGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
          shardGeometry.computeVertexNormals();

          const shardMaterial = new THREE.MeshPhysicalMaterial({
            color: 0xF9F6EE,
            metalness: 0.1,
            roughness: 0.05,
            transmission: 0.9,
            thickness: 0.5,
            transparent: true,
            opacity: 0.4,
            side: THREE.DoubleSide,
            envMapIntensity: 1,
            clearcoat: 1,
            clearcoatRoughness: 0.1
          });

          const shard = new THREE.Mesh(shardGeometry, shardMaterial);

          const radius = 8 + Math.random() * 7;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.random() * Math.PI / 2;

          shard.position.x = radius * Math.sin(phi) * Math.cos(theta);
          shard.position.y = radius * Math.sin(phi) * Math.sin(theta);
          shard.position.z = -Math.abs(radius * Math.cos(phi));

          shard.rotation.x = Math.random() * Math.PI * 2;
          shard.rotation.y = Math.random() * Math.PI * 2;
          shard.rotation.z = Math.random() * Math.PI * 2;

          shard.userData.rotationSpeed = {
            x: (Math.random() - 0.5) * 0.01,
            y: (Math.random() - 0.5) * 0.01,
            z: (Math.random() - 0.5) * 0.01
          };

          shardGroup.add(shard);
          shardMeshes.push(shard);
        }

        scene.add(shardGroup);

        // Load GLB files
        const glbUrls = [
          'assets/Temple.glb',
          'assets/Torii.glb',
          'assets/Motorcycle.glb',
          'assets/Pagoda.glb'
        ];

        const scrollUrl = 'assets/Parchment.glb';

        const loadedModels = [];
        for (const url of glbUrls) {
          try {
            const meshes = await loadGLB(url);
            let allPositions = [];
            for (const meshData of meshes) {
              if (meshData.indices) {
                for (let i = 0; i < meshData.indices.length; i++) {
                  const idx = meshData.indices[i] * 3;
                  allPositions.push(
                    meshData.positions[idx],
                    meshData.positions[idx + 1],
                    meshData.positions[idx + 2]
                  );
                }
              } else {
                allPositions.push(...meshData.positions);
              }
            }

            const positions = new Float32Array(allPositions);
            const normalized = normalizeGeometry(positions, 2.5);
            loadedModels.push({ positions: normalized });
          } catch (err) {
            console.error(`Failed to load ${url}:`, err);
            const fallback = generateFallbackShape();
            loadedModels.push({ positions: fallback });
          }
        }

        if (loadedModels.length === 0) {
          throw new Error('No models loaded successfully');
        }

        // Load scroll model
        try {
          const scrollMeshes = await loadGLB(scrollUrl);
          let scrollPositions = [];
          for (const meshData of scrollMeshes) {
            if (meshData.indices) {
              for (let i = 0; i < meshData.indices.length; i++) {
                const idx = meshData.indices[i] * 3;
                scrollPositions.push(
                  meshData.positions[idx],
                  meshData.positions[idx + 1],
                  meshData.positions[idx + 2]
                );
              }
            } else {
              scrollPositions.push(...meshData.positions);
            }
          }
          const normalizedScroll = normalizeGeometry(new Float32Array(scrollPositions), 3.5);
          scrollModelRef.current = { positions: normalizedScroll };
        } catch (err) {
          console.error('Failed to load scroll:', err);
        }

        // Expand everything at once (scroll included)
        loadedModels.push(scrollModelRef.current);
        const expandedModels = expandToMaxVertices(loadedModels);

        modelDataRef.current = expandedModels.slice(0, -1);
        scrollModelRef.current = expandedModels[expandedModels.length - 1];

        // Create mesh with first model
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(expandedModels[0].positions.slice(), 3));
        geometry.setAttribute('targetPosition', new THREE.BufferAttribute(expandedModels[0].positions.slice(), 3));
        geometry.setAttribute('originalPosition', new THREE.BufferAttribute(expandedModels[0].positions.slice(), 3));
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
          color: 0xC0C0C0,
          metalness: 0.7,
          roughness: 0.3,
          flatShading: false,
          side: THREE.DoubleSide
        });

        mesh = new THREE.Mesh(geometry, material);
        meshRef.current = mesh;
        mesh.rotateX(0.2);
        scene.add(mesh);

        // Animation variables
        let morphProgress = 0;
        let ripplePhase = 0;
        const morphDuration = 120;
        let frameCount = 0;
        const shapeChangeInterval = 300;
        let localCurrentShape = 0;
        let isMorphing = false;
        const constantRotationSpeed = 0.003;

        // Mouse interaction variables
        let isDragging = false;
        let previousMouseX = 0;
        let previousMouseY = 0;
        let rotationVelocityX = 0;
        let rotationVelocityY = 0;
        const damping = 0.95;

        // Mouse event handlers
        const handleMouseDown = (e) => {
          isDragging = true;
          previousMouseX = e.clientX;
          previousMouseY = e.clientY;
          rotationVelocityX = 0;
          rotationVelocityY = 0;
        };

        const handleMouseMove = (e) => {
          if (!isDragging) return;
          const deltaX = e.clientX - previousMouseX;
          const deltaY = e.clientY - previousMouseY;

          rotationVelocityY = deltaX * 0.005;
          rotationVelocityX = deltaY * 0.005;

          mesh.rotation.y += rotationVelocityY;
          mesh.rotation.x += rotationVelocityX;

          previousMouseX = e.clientX;
          previousMouseY = e.clientY;
        };

        const handleMouseUp = () => {
          isDragging = false;
        };

        const handleTouchStart = (e) => {
          if (e.touches.length === 1) {
            isDragging = true;
            previousMouseX = e.touches[0].clientX;
            previousMouseY = e.touches[0].clientY;
            rotationVelocityX = 0;
            rotationVelocityY = 0;
          }
        };

        const handleTouchMove = (e) => {
          if (!isDragging || e.touches.length !== 1) return;
          e.preventDefault();

          const deltaX = e.touches[0].clientX - previousMouseX;
          const deltaY = e.touches[0].clientY - previousMouseY;

          rotationVelocityY = deltaX * 0.005;
          rotationVelocityX = deltaY * 0.005;

          mesh.rotation.y += rotationVelocityY;
          mesh.rotation.x += rotationVelocityX;

          previousMouseX = e.touches[0].clientX;
          previousMouseY = e.touches[0].clientY;
        };

        const handleTouchEnd = () => {
          isDragging = false;
        };

        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('mouseup', handleMouseUp);
        canvas.addEventListener('mouseleave', handleMouseUp);
        canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
        canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
        canvas.addEventListener('touchend', handleTouchEnd);

        // Animation loop
        const animate = () => {
          animationId = requestAnimationFrame(animate);

          const geometry = mesh.geometry;
          const positions = geometry.attributes.position.array;
          const targetPositions = geometry.attributes.targetPosition.array;
          const originalPositions = geometry.attributes.originalPosition.array;

          // Constant rotation
          mesh.rotation.y += constantRotationSpeed;

          // Apply inertia from dragging
          if (!isDragging) {
            mesh.rotation.y += rotationVelocityY;
            mesh.rotation.x += rotationVelocityX;
            rotationVelocityX *= damping;
            rotationVelocityY *= damping;
          }

          // Rotate individual shards
          shardMeshes.forEach(shard => {
            shard.rotation.x += shard.userData.rotationSpeed.x;
            shard.rotation.y += shard.userData.rotationSpeed.y;
            shard.rotation.z += shard.userData.rotationSpeed.z;
          });

          frameCount++;

          // Trigger morph between shapes
          if (frameCount % shapeChangeInterval === 0 && modelDataRef.current.length > 1) {
            morphProgress = 0;
            isMorphing = true;
            const nextShape = (localCurrentShape + 1) % modelDataRef.current.length;
            setCurrentShape(nextShape);

            const nextModel = modelDataRef.current[nextShape];
            geometry.attributes.targetPosition.array.set(nextModel.positions);
            geometry.attributes.originalPosition.array.set(positions);

            localCurrentShape = nextShape;
          }

          // Morphing animation
          if (isMorphing && morphProgress < 1) {
            morphProgress += 1 / morphDuration;
            const eased = morphProgress < 0.5
              ? 2 * morphProgress * morphProgress
              : 1 - Math.pow(-2 * morphProgress + 2, 2) / 2;

            for (let i = 0; i < positions.length; i += 3) {
              positions[i] = originalPositions[i] + (targetPositions[i] - originalPositions[i]) * eased;
              positions[i + 1] = originalPositions[i + 1] + (targetPositions[i + 1] - originalPositions[i + 1]) * eased;
              positions[i + 2] = originalPositions[i + 2] + (targetPositions[i + 2] - originalPositions[i + 2]) * eased;
            }
            geometry.attributes.position.needsUpdate = true;
            geometry.computeVertexNormals();

            if (morphProgress >= 1) {
              isMorphing = false;
            }
          }

          // Ripple effect during morphing
          ripplePhase += 0.05;
          if (morphProgress > 0 && morphProgress < 1) {
            for (let i = 0; i < positions.length; i += 3) {
              const x = positions[i];
              const y = positions[i + 1];
              const z = positions[i + 2];
              const dist = Math.sqrt(x * x + y * y + z * z);
              const ripple = Math.sin(dist * 5 - ripplePhase * 3) * 0.05 * (1 - morphProgress);

              positions[i] += x * ripple;
              positions[i + 1] += y * ripple;
              positions[i + 2] += z * ripple;
            }
            geometry.attributes.position.needsUpdate = true;
            geometry.computeVertexNormals();
          }

          renderer.render(scene, camera);
        };

        animate();
        setLoading(false);

        // Cleanup event listeners
        return () => {
          canvas.removeEventListener('mousedown', handleMouseDown);
          canvas.removeEventListener('mousemove', handleMouseMove);
          canvas.removeEventListener('mouseup', handleMouseUp);
          canvas.removeEventListener('mouseleave', handleMouseUp);
          canvas.removeEventListener('touchstart', handleTouchStart);
          canvas.removeEventListener('touchmove', handleTouchMove);
          canvas.removeEventListener('touchend', handleTouchEnd);
        };

      } catch (err) {
        console.error('Initialization error:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    // Fallback shape generator
    const generateFallbackShape = () => {
      const positions = [];
      const segments = 32;

      for (let i = 0; i <= segments; i++) {
        for (let j = 0; j <= segments; j++) {
          const u = (i / segments) * Math.PI * 2;
          const v = (j / segments) * Math.PI;

          const x = Math.sin(v) * Math.cos(u) * 1.5;
          const y = Math.sin(v) * Math.sin(u) * 1.5;
          const z = Math.cos(v) * 1.5;

          positions.push(x, y, z);
        }
      }

      return new Float32Array(positions);
    };

    const cleanup = init();

    // Handle resize
    const handleResize = () => {
      if (!cameraRef.current || !rendererRef.current) return;
      cameraRef.current.aspect = window.innerWidth / window.innerHeight;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(window.innerWidth, window.innerHeight);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationId) cancelAnimationFrame(animationId);
      if (mesh && mesh.geometry) mesh.geometry.dispose();
      if (mesh && mesh.material) mesh.material.dispose();
      if (renderer) renderer.dispose();
      cleanup?.then(fn => fn?.());
    };
  }, []);

  // Intersection Observer for scroll-based fade-in
  useEffect(() => {
    const observerOptions = {
      threshold: 0.1,
      rootMargin: '0px 0px -50px 0px'
    };

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
        }
      });
    }, observerOptions);

    // Observe sections
    document.querySelectorAll('.portfolio-section').forEach(section => {
      observer.observe(section);
    });

    // Observe timeline items
    document.querySelectorAll('.timeline-item').forEach((item, index) => {
      setTimeout(() => {
        observer.observe(item);
      }, index * 100);
    });

    return () => observer.disconnect();
  }, [loading]);

  // Active nav link on scroll
  useEffect(() => {
    const handleScroll = () => {
      let current = 'home';
      const sections = document.querySelectorAll('[data-section]');

      sections.forEach(section => {
        const sectionTop = section.offsetTop;
        if (window.scrollY >= (sectionTop - 200)) {
          current = section.getAttribute('data-section');
        }
      });

      setActiveSection(current);
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Smooth scroll for nav links
  const handleNavClick = useCallback((e, targetId) => {
    e.preventDefault();
    const target = document.getElementById(targetId);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setMobileMenuOpen(false);
  }, []);

  if (error) {
    return (
      <div className="error-container">
        <div className="error-content">
          <h2>Error Loading Models</h2>
          <p>{error}</p>
          <p>Please check that your GLB file paths are correct and accessible.</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Loading overlay */}
      {loading && (
        <div className="loading-overlay">
          Loading models...
        </div>
      )}

      {/* Fixed Three.js background canvas */}
      <canvas
        ref={canvasRef}
        className="three-bg-canvas"
      />

      {/* Model counter */}
      {!loading && (
        <div className="model-counter">
          MODEL {currentShape + 1} / {modelDataRef.current.length}
        </div>
      )}

      {/* Portfolio overlay content */}
      <div className="portfolio-overlay">
        {/* Navigation */}
        <nav className="site-nav">
          <div className="nav-container">
            <div className="nav-logo">Andrew Li</div>
            <button className="menu-toggle" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
              <span></span>
              <span></span>
              <span></span>
            </button>
            <ul className={`nav-links${mobileMenuOpen ? ' nav-open' : ''}`}>
              <li><a href="#home" className={activeSection === 'home' ? 'active' : ''} onClick={(e) => handleNavClick(e, 'home')}>Home</a></li>
              <li><a href="#work" className={activeSection === 'work' ? 'active' : ''} onClick={(e) => handleNavClick(e, 'work')}>Work</a></li>
              <li><a href="#projects" className={activeSection === 'projects' ? 'active' : ''} onClick={(e) => handleNavClick(e, 'projects')}>Projects</a></li>
              <li><a href="#contact" className={activeSection === 'contact' ? 'active' : ''} onClick={(e) => handleNavClick(e, 'contact')}>Contact</a></li>
            </ul>
          </div>
        </nav>

        {/* Hero / Bio Section */}
        <header id="home" data-section="home" className="hero-section">
          <div className="container">
            <div className="header-content">
              <h1>Andrew Li</h1>
              <p className="tagline">Software Engineering Student</p>
              <p className="bio">
                I'm a software engineering student with a broad interest in technology and design.
                I enjoy turning ideas into simple, reliable, and well-structured software solutions.
              </p>
            </div>
          </div>
        </header>

        {/* Work Experience Section */}
        <section id="work" data-section="work" className="portfolio-section">
          <div className="container">
            <h2>Work Experience</h2>
            <div className="timeline">
              <div className="timeline-item">
                <h3 className="job-title">Software Engineer Intern</h3>
                <p className="company">MDA Space</p>
                <p className="duration">Sept 2025 - Present</p>
                <p className="job-description">
                  Contributed to embedded software focused on concurrent processing and deterministic control,
                  integrating TCP and serial communication for real-time systems.
                </p>
              </div>

              <div className="timeline-item">
                <h3 className="job-title">Software Engineering Intern</h3>
                <p className="company">Ajile Light Industries</p>
                <p className="duration">Jan 2025 - Aug 2025</p>
                <p className="job-description">
                  Worked on robotics and embedded systems, building CI/CD pipelines and automated testing tools to support fast, reliable development in a startup environment.
                </p>
              </div>

              <div className="timeline-item">
                <h3 className="job-title">Data Analyst</h3>
                <p className="company">NAV Canada</p>
                <p className="duration">Apr 2024 - Aug 2024</p>
                <p className="job-description">
                  Automated data analysis workflows using Python, visualized trends, and presented key findings to support system performance reviews.
                </p>
              </div>

              <div className="timeline-item">
                <h3 className="job-title">Backend Developer</h3>
                <p className="company">Project Tech Conferences</p>
                <p className="duration">Apr 2022 - Aug 2023</p>
                <p className="job-description">
                  Built new backend features and functionality for internal tools and the public website to enhance usability and performance.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Projects Section */}
        <section id="projects" data-section="projects" className="portfolio-section">
          <div className="container">
            <h2>Projects</h2>
            <div className="projects-grid">
              <div className="project-card">
                <h4 className="project-title">Caliscan</h4>
                <div className="project-tech">
                  <span className="tech-pill">Computer Vision</span>
                  <span className="tech-pill">React</span>
                  <span className="tech-pill">Mediapipe</span>
                </div>
                <p className="project-description">
                  Analyzes calisthenics form from videos using pose detection and feedback overlay.
                </p>
                <div className="project-links">
                  <a href="https://github.com/axli16/Caliscan" className="project-link" target="_blank" rel="noopener noreferrer">Github <span className="arrow">→</span></a>
                </div>
              </div>

              <div className="project-card">
                <h4 className="project-title">TradeSim</h4>
                <div className="project-tech">
                  <span className="tech-pill">AWS</span>
                  <span className="tech-pill">React</span>
                  <span className="tech-pill">Graphing</span>
                </div>
                <p className="project-description">
                  A realistic web-based trading simulator that lets users practice day trading with live market data and portfolio tracking.
                </p>
                <div className="project-links">
                  <a href="https://github.com/axli16/TradeSim" className="project-link" target="_blank" rel="noopener noreferrer">GitHub <span className="arrow">→</span></a>
                </div>
              </div>

              <div className="project-card">
                <h4 className="project-title">StockSight</h4>
                <div className="project-tech">
                  <span className="tech-pill">AI</span>
                  <span className="tech-pill">Python</span>
                  <span className="tech-pill">scikit-learn</span>
                </div>
                <p className="project-description">
                  An AI-powered model that predicts daily stock movements using market data and technical indicators.
                </p>
                <div className="project-links">
                  <a href="https://github.com/axli16/StockSight" className="project-link" target="_blank" rel="noopener noreferrer">GitHub <span className="arrow">→</span></a>
                </div>
              </div>

              <div className="project-card">
                <h4 className="project-title">Text Editor</h4>
                <div className="project-tech">
                  <span className="tech-pill">C++</span>
                  <span className="tech-pill">Systems</span>
                </div>
                <p className="project-description">
                  A lightweight text editor built from scratch with custom features for writing and file management.
                </p>
                <div className="project-links">
                  <a href="https://github.com/axli16/TextEditor" className="project-link" target="_blank" rel="noopener noreferrer">GitHub <span className="arrow">→</span></a>
                </div>
              </div>

              <div className="project-card">
                <h4 className="project-title">SpinLab</h4>
                <div className="project-tech">
                  <span className="tech-pill">3D</span>
                  <span className="tech-pill">Three.js</span>
                  <span className="tech-pill">Animations</span>
                </div>
                <p className="project-description">
                  An interactive Three.js showcase room of morphing point clouds, mesh transitions, and smooth 3D spinning.
                </p>
                <div className="project-links">
                  <a href="https://github.com/axli16/SpinLab" className="project-link" target="_blank" rel="noopener noreferrer">GitHub <span className="arrow">→</span></a>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Contact Section */}
        <section id="contact" data-section="contact" className="portfolio-section contact-section">
          <div className="container">
            <h2>Let's Connect</h2>
            <p className="contact-subtitle">
              I'm always interested in hearing about new projects and opportunities.
            </p>
            <div className="contact-links">
              <a href="mailto:andrew.x.L815@gmail.com" className="contact-btn">andrew.x.L815@gmail.com</a>
              <a href="https://www.linkedin.com/in/andrew-li-sw/" className="contact-btn" target="_blank" rel="noopener noreferrer">LinkedIn</a>
            </div>
          </div>
        </section>
      </div>
    </>
  );
};
