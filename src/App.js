import React, { useRef, useEffect, useState } from 'react';
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
  const viewModeRef = useRef('objects');
  const [currentViewMode, setCurrentViewMode] = useState('objects');
  const modelDataRef = useRef([]);
  const scrollModelRef = useRef(null);
  const iconModelsRef = useRef([]);
  const textMeshRef = useRef(null);
  const [textMeshes, setTextMeshes] = useState([]);
  const textIndex = useRef(0);
  const textMap = {
    'about': 0,
    'CV': 1,
    'projects': 2
  };

  // GLTFLoader equivalent using fetch and manual parsing
  const loadGLB = async (url) => {
    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      
      const dataView = new DataView(arrayBuffer);
      
      // Check GLB magic number
      const magic = dataView.getUint32(0, true);
      if (magic !== 0x46546C67) {
        throw new Error('Not a valid GLB file');
      }
      
      // Get JSON chunk
      const jsonChunkLength = dataView.getUint32(12, true);
      const jsonChunkType = dataView.getUint32(16, true);
      
      if (jsonChunkType !== 0x4E4F534A) {
        throw new Error('Invalid GLB format');
      }
      
      const jsonData = new Uint8Array(arrayBuffer, 20, jsonChunkLength);
      const gltf = JSON.parse(new TextDecoder().decode(jsonData));
      
      // Get binary chunk
      const binaryChunkLength = dataView.getUint32(20 + jsonChunkLength, true);
      const binaryData = new Uint8Array(arrayBuffer, 28 + jsonChunkLength, binaryChunkLength);
      
      // Extract all mesh data
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
            
            // Get indices if they exist
            let indices = null;
            if (primitive.indices !== undefined) {
              const indAccessor = gltf.accessors[primitive.indices];
              const indBufferView = gltf.bufferViews[indAccessor.bufferView];
              const indByteOffset = (indBufferView.byteOffset || 0) + (indAccessor.byteOffset || 0);
              
              if (indAccessor.componentType === 5123) { // UNSIGNED_SHORT
                indices = new Uint16Array(
                  binaryData.buffer,
                  binaryData.byteOffset + indByteOffset,
                  indAccessor.count
                );
              } else if (indAccessor.componentType === 5125) { // UNSIGNED_INT
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
    // Find the model with the most vertices
    const maxVertices = Math.max(...models.map(m => m.positions.length / 3));
    
    return models.map(model => {
      const currentCount = model.positions.length / 3;
      
      if (currentCount === maxVertices) {
        return { ...model, vertexCount: currentCount };
      }
      
      // Expand to max vertices by repeating/collapsing extra vertices
      const expandedPositions = new Float32Array(maxVertices * 3);
      
      // Fill in the original vertices
      for (let i = 0; i < currentCount; i++) {
        const srcIdx = i * 3;
        const dstIdx = i * 3;
        expandedPositions[dstIdx] = model.positions[srcIdx];
        expandedPositions[dstIdx + 1] = model.positions[srcIdx + 1];
        expandedPositions[dstIdx + 2] = model.positions[srcIdx + 2];
      }
      
      // For extra vertices, collapse them to existing vertices
      // Distribute them across the existing vertices
      for (let i = currentCount; i < maxVertices; i++) {
        // Map extra vertex to an existing vertex (cycling through)
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
        scene.background = new THREE.Color(0x000000);
        sceneRef.current = scene;

        // Setup camera
        camera = new THREE.PerspectiveCamera(
          75,
          canvas.clientWidth / canvas.clientHeight,
          0.1,
          1000
        );
        camera.position.z = 3;
        cameraRef.current = camera;

        // Setup renderer
        renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
        renderer.setSize(canvas.clientWidth, canvas.clientHeight);
        renderer.setPixelRatio(window.devicePixelRatio);
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

        // Create floating glass shards - mirror dimension effect
        const shardGroup = new THREE.Group();
        const shardCount = 20;
        const shardGeometries = [];
        const shardMeshes = [];
        
        for (let i = 0; i < shardCount; i++) {
          // Create irregular triangular shard
          const size = Math.random() * 0.8 + 0.3;
          const vertices = new Float32Array([
            // Triangle with slight irregularity
            0, size, 0,
            -size * 0.8 + Math.random() * 0.2, -size * 0.6, Math.random() * 0.2,
            size * 0.8 + Math.random() * 0.2, -size * 0.5, Math.random() * 0.2
          ]);
          
          const shardGeometry = new THREE.BufferGeometry();
          shardGeometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
          shardGeometry.computeVertexNormals();
          
          // Glass-like material with reflections
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
          
          // Random position in a sphere around the scene
          const radius = 8 + Math.random() * 7;
          const theta = Math.random() * Math.PI * 2;
          const phi = Math.random() * Math.PI / 2;
          
          shard.position.x = radius * Math.sin(phi) * Math.cos(theta);
          shard.position.y = radius * Math.sin(phi) * Math.sin(theta);
          shard.position.z = -Math.abs(radius * Math.cos(phi));
          
          // Random rotation
          shard.rotation.x = Math.random() * Math.PI * 2;
          shard.rotation.y = Math.random() * Math.PI * 2;
          shard.rotation.z = Math.random() * Math.PI * 2;
          
          // Store rotation speed for animation
          shard.userData.rotationSpeed = {
            x: (Math.random() - 0.5) * 0.01,
            y: (Math.random() - 0.5) * 0.01,
            z: (Math.random() - 0.5) * 0.01
          };
          
          shardGroup.add(shard);
          shardMeshes.push(shard);
        }
        
        scene.add(shardGroup);

        // Load GLB files - REPLACE THESE WITH YOUR FILE PATHS
        const glbUrls = [
          'assets/Temple.glb',
          'assets/Torii.glb',
          'assets/Motorcycle.glb'
        ];

        const scrollUrl = 'assets/Parchment.glb';
        
        // Icon URLs - replace with your icon GLB files
        // const iconUrls = {
        //   mail: 'path/to/mail-icon.glb',
        //   phone: 'path/to/phone-icon.glb',
        //   linkedin: 'path/to/linkedin-icon.glb',
        //   github: 'path/to/github-icon.glb'
        // };

        // Load all models
        const loadedModels = [];
        for (const url of glbUrls) {
          try {
            const meshes = await loadGLB(url);
            // Combine all meshes from this model
            let allPositions = [];
            for (const meshData of meshes) {
              if (meshData.indices) {
                // Convert indexed geometry to non-indexed
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
            // Fallback to a simple shape
            const fallback = generateFallbackShape();
            loadedModels.push({ positions: fallback });
          }
        }

        if (loadedModels.length === 0) {
          throw new Error('No models loaded successfully');
        }

        // Expand all models to have the same vertex count (max)
        // const expandedModels = expandToMaxVertices(loadedModels);
        // modelDataRef.current = expandedModels;

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
        
        // 3️⃣ Expand everything at once (scroll included)
        loadedModels.push(scrollModelRef.current);
        const expandedModels = expandToMaxVertices(loadedModels);

        // 4️⃣ Store separately if needed
        modelDataRef.current = expandedModels.slice(0, -1); // all but scroll 
        scrollModelRef.current = expandedModels[expandedModels.length - 1];

        // Load icon models
        // try {
        //   for (const [key, url] of Object.entries(iconUrls)) {
        //     const iconMeshes = await loadGLB(url);
        //     let iconPositions = [];
        //     for (const meshData of iconMeshes) {
        //       if (meshData.indices) {
        //         for (let i = 0; i < meshData.indices.length; i++) {
        //           const idx = meshData.indices[i] * 3;
        //           iconPositions.push(
        //             meshData.positions[idx],
        //             meshData.positions[idx + 1],
        //             meshData.positions[idx + 2]
        //           );
        //         }
        //       } else {
        //         iconPositions.push(...meshData.positions);
        //       }
        //     }
        //     const normalizedIcon = normalizeGeometry(new Float32Array(iconPositions));
        //     iconModelsRef.current.push({ 
        //       name: key, 
        //       positions: normalizedIcon 
        //     });
        //   }
        // } catch (err) {
        //   console.error('Failed to load icons:', err);
        // }

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
        mesh.userData.baseRotation = { x: 0, y: 0 }; // Track rotation for scroll mode
        meshRef.current = mesh;
        mesh.rotateX(0.2);
        scene.add(mesh);
        
        // Create 3D text for scroll view
        const createTextMesh = (lines) => {
          const canvas = document.createElement('canvas');
          const context = canvas.getContext('2d');
          canvas.width = 1024;
          canvas.height = 1024;
          
          context.fillStyle = 'transparent';
          context.fillRect(0, 0, canvas.width, canvas.height);
          
          context.font = 'bold 40px Roboto Mono';
          context.fillStyle = 'white';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          
          
          const lineHeight = 80;
          const startY = canvas.height / 2 - (lines.length * lineHeight) / 2;
          
          lines.forEach((line, i) => {
            context.fillText(line, canvas.width / 2, startY + i * lineHeight);
          });
          
          const texture = new THREE.CanvasTexture(canvas);
          texture.needsUpdate = true;
          
          const textGeometry = new THREE.PlaneGeometry(2.5, 2.5);
          const textMaterial = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthTest: false, 
            depthWrite: false,
            opacity: 0,
            side: THREE.DoubleSide
          });
          
          const textMesh = new THREE.Mesh(textGeometry, textMaterial);
          textMesh.position.z = 0.1; // Slightly in front
          textMeshRef.current = textMesh;
          scene.add(textMesh);
          return textMesh;
        };

        let textMeshes = [];
        let aboutTextMesh = [];
        
        const aboutMe = [
          'Hi, I\'m Andrew,',
          'a Software Engineering student at Carleton University',
          'with experience in backend development,',
          'data analysis, and embedded systems.',
          'I love building efficient, data-driven ',
          'solutions and exploring how software',
          'can bridge the digital and physical worlds.',
          'Outside of coding, you\'ll usually find me at ',
          'the gym, on the slopes, or reading about new tech.',
          ''
        ];
        aboutTextMesh.push(createTextMesh(aboutMe));
        textMeshes.push(aboutTextMesh);
        

        let cvTextMeshes = [];
        let cvLines = [
          'MDA Space',
          'Software Engineering Intern',
          'Sept 2025 - Sept 2026',
          '',
        ]
        cvTextMeshes.push(createTextMesh(cvLines));
        cvLines = [
          'Ajile Light Industries',
          'Software Engineering Intern',
          'Jan 2025 - Aug 2025',
        ]
        cvTextMeshes.push(createTextMesh(cvLines));
        cvLines = [
          'NAV Canada',
          'Data Analyst Co-op',
          'May 2024 - Aug 2024',
        ];
        cvTextMeshes.push(createTextMesh(cvLines));
        cvLines = [
          'Project Tech Conferences',
          'Backend Developer',
          'Apr 2022 - Aug 2023',
        ]
        cvTextMeshes.push(createTextMesh(cvLines));
        textMeshes.push(cvTextMeshes);
        
        let projectsTextMeshes = [];
        let projectLines = [
          'Calisthenics Coach',
          ''
        ]
        projectsTextMeshes.push(createTextMesh(projectLines));
        textMeshes.push(projectsTextMeshes);

        setTextMeshes(textMeshes);
        console.log('Text meshes created:', textMeshes);
        

        // Animation variables
        let morphProgress = 0;
        let ripplePhase = 0;
        const morphDuration = 120;
        let frameCount = 0;
        const shapeChangeInterval = 300;
        let localCurrentShape = 0;
        let isMorphing = false;
        const constantRotationSpeed = 0.003;
        let lastViewMode = 'objects';
        let viewMorphProgress = 0;
        let isViewMorphing = false;

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
 
          // Move text with the mesh
          if (textMeshRef.current) {
            textMeshRef.current.rotation.y = mesh.rotation.y;
            textMeshRef.current.rotation.x = mesh.rotation.x;
          }
          
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

          // Move text with the mesh
          if (textMeshRef.current) {
            textMeshRef.current.rotation.y = mesh.rotation.y;
            textMeshRef.current.rotation.x = mesh.rotation.x;
          }
          
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
          
          // Constant rotation for the model (only in objects mode)
          if (viewModeRef.current === 'objects') {
            mesh.rotation.y += constantRotationSpeed;
            // Fade out text
            if (textMeshRef.current && textMeshRef.current.material.opacity > 0) {
              textMeshRef.current.material.opacity -= 0.02;
            }
          } else if (viewModeRef.current === 'about' || viewModeRef.current === 'projects' || viewModeRef.current === 'icons' || viewModeRef.current === 'CV') {
            // Keep scroll facing forward
            const targetRotX = 0;
            const targetRotY = 0;
            mesh.rotation.x += (targetRotX - mesh.rotation.x) * 0.1;
            mesh.rotation.y += (targetRotY - mesh.rotation.y) * 0.1;

             // Sync text with mesh
            if (textMeshRef.current) {
              textMeshRef.current.rotation.x = mesh.rotation.x;
              textMeshRef.current.rotation.y = mesh.rotation.y;
              
              // Fade in text
              if (textMeshRef.current.material.opacity < 1) {
                textMeshRef.current.material.opacity += 0.01;
              }
            }
          }

          // Apply inertia from dragging on top of constant rotation
          if (!isDragging) {
            mesh.rotation.y += rotationVelocityY;
            mesh.rotation.x += rotationVelocityX;
            // Sync text rotation
            if (textMeshRef.current && viewModeRef.current === 'about') {
              textMeshRef.current.rotation.y = mesh.rotation.y;
              textMeshRef.current.rotation.x = mesh.rotation.x;
            }
            rotationVelocityX *= damping;
            rotationVelocityY *= damping;
          }

          // Rotate background sphere in opposite direction
          // shardGroup.rotation.y -= constantRotationSpeed * 0.4;
          // shardGroup.rotation.x -= constantRotationSpeed * 0.2;
          
          // Rotate individual shards
          shardMeshes.forEach(shard => {
            shard.rotation.x += shard.userData.rotationSpeed.x;
            shard.rotation.y += shard.userData.rotationSpeed.y;
            shard.rotation.z += shard.userData.rotationSpeed.z;
          });

          frameCount++;

          // Handle view mode morphing
          if (isViewMorphing && viewMorphProgress < 1) {
            viewMorphProgress += 1 / morphDuration;
            const eased = viewMorphProgress < 0.5
              ? 2 * viewMorphProgress * viewMorphProgress
              : 1 - Math.pow(-2 * viewMorphProgress + 2, 2) / 2;

            for (let i = 0; i < positions.length; i += 3) {
              positions[i] = originalPositions[i] + (targetPositions[i] - originalPositions[i]) * eased;
              positions[i + 1] = originalPositions[i + 1] + (targetPositions[i + 1] - originalPositions[i + 1]) * eased;
              positions[i + 2] = originalPositions[i + 2] + (targetPositions[i + 2] - originalPositions[i + 2]) * eased;
            }
            geometry.attributes.position.needsUpdate = true;
            geometry.computeVertexNormals();

            if (viewMorphProgress >= 1) {
              isViewMorphing = false;
            }
          }

          // Trigger morph (only in objects mode)
          if (viewModeRef.current === 'objects' && frameCount % shapeChangeInterval === 0 && modelDataRef.current.length > 1 && !isViewMorphing) {
            morphProgress = 0;
            isMorphing = true;
            const nextShape = (localCurrentShape + 1) % modelDataRef.current.length;
            setCurrentShape(nextShape);
            
            const nextModel = modelDataRef.current[nextShape];
            geometry.attributes.targetPosition.array.set(nextModel.positions);
            geometry.attributes.originalPosition.array.set(positions);
            
            localCurrentShape = nextShape;
            lastViewMode = 'objects';
            
          }else if (viewModeRef.current === 'about' && lastViewMode !== 'about') {
            // Switch to about model
            morphProgress = 0;
            isMorphing = true;

            const nextModel = scrollModelRef.current;
            geometry.attributes.targetPosition.array.set(nextModel.positions);
            geometry.attributes.originalPosition.array.set(positions);
            lastViewMode = 'about';
          }else if (viewModeRef.current === 'projects' && lastViewMode !== 'projects') {
            // Switch to projects model
            morphProgress = 0;
            isMorphing = true;

            const nextModel = scrollModelRef.current;
            geometry.attributes.targetPosition.array.set(nextModel.positions);
            geometry.attributes.originalPosition.array.set(positions);
            lastViewMode = 'projects';
          }else if (viewModeRef.current === 'CV' && lastViewMode !== 'CV') {
            // Switch to CV model
            morphProgress = 0;
            isMorphing = true;

            const nextModel = scrollModelRef.current;
            geometry.attributes.targetPosition.array.set(nextModel.positions);
            geometry.attributes.originalPosition.array.set(positions);
            lastViewMode = 'CV';
          }else if (viewModeRef.current === 'icons' && lastViewMode !== 'icons') {
            // Switch to icons model
            morphProgress = 0;
            isMorphing = true;

            const nextModel = scrollModelRef.current;
            geometry.attributes.targetPosition.array.set(nextModel.positions);
            geometry.attributes.originalPosition.array.set(positions);
            lastViewMode = 'icons';
          }

          // Morphing animation (only when not view morphing)
          if (isMorphing && morphProgress < 1 && !isViewMorphing) {
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

          // Ripple effect
          ripplePhase += 0.05;
          if ((morphProgress > 0 && morphProgress < 1 && !isViewMorphing) || (isViewMorphing && viewMorphProgress > 0 && viewMorphProgress < 1)) {
            const activeProgress = isViewMorphing ? viewMorphProgress : morphProgress;
            for (let i = 0; i < positions.length; i += 3) {
              const x = positions[i];
              const y = positions[i + 1];
              const z = positions[i + 2];
              const dist = Math.sqrt(x * x + y * y + z * z);
              const ripple = Math.sin(dist * 5 - ripplePhase * 3) * 0.05 * (1 - activeProgress);
              
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
      if (!camera || !renderer) return;
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
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

  const handleButtonClick = (mode) => {

    if (viewModeRef.current === mode && mode !== 'objects') {
      // Toggle back to objects mode
      viewModeRef.current = 'objects';
      setCurrentViewMode('objects');
    } else {
      viewModeRef.current = mode;
      setCurrentViewMode(mode);
      if (mode !== 'objects' && mode !== 'icons') {
        // Fade out text
        if (textMeshRef.current && textMeshRef.current.material.opacity > 0) {
          textMeshRef.current.material.opacity = 0;
        }
        textMeshRef.current = textMeshes[textMap[mode]][0];
      }
    }
  };

  const handleScrollButtonClick = (direction) => {
    if (direction === 'previous') {
      if (textIndex.current === 0){
        return;
      }
      textIndex.current = (textIndex.current - 1) % textMeshes[textMap[viewModeRef.current]].length;
    } else if (direction === 'next') {
      if (textIndex.current === textMeshes[textMap[viewModeRef.current]].length -1){
        return;
      }
      textIndex.current = (textIndex.current + 1) % textMeshes[textMap[viewModeRef.current]].length;
    }

    // Fade out text
    if (textMeshRef.current && textMeshRef.current.material.opacity > 0) {
      textMeshRef.current.material.opacity = 0;
    }
    textMeshRef.current = textMeshes[textMap[viewModeRef.current]][textIndex.current];
  }

  const socialLinks = {
    mail: 'mailto:andrew.x.L815@email.com',
    phone: 'tel:+1 613-864-9098',
    linkedin: 'https://linkedin.com/in/yourprofile',
    github: 'https://github.com/yourprofile'
  };

  if (error) {
    return (
      <div className="w-full h-screen bg-black flex items-center justify-center">
        <div className="text-red-500 text-center p-8">
          <h2 className="text-xl font-bold mb-4">Error Loading Models</h2>
          <p className="mb-4">{error}</p>
          <p className="text-sm text-gray-400">
            Please check that your GLB file paths are correct and accessible.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-white flex items-center justify-center overflow-hidden relative">
      {loading && (
        <div className="absolute z-10 text-gray-800 text-xl font-mono">
          Loading models...
        </div>
      )}
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-grab active:cursor-grabbing"
        style={{ display: 'block' }}
      />
      
      {/* Glass Shard Buttons */}
      {!loading && (
        <>
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 flex gap-4 z-20">
            {/* Button 1 - Home/Objects */}
            <button
              onClick={() => handleButtonClick('objects')}
              className={`relative w-16 h-16 transition-all duration-300 ${
                currentViewMode === 'objects' ? 'opacity-100 scale-110' : 'opacity-70 hover:opacity-100 hover:scale-105'
              }`}
              style={{
                clipPath: 'polygon(50% 0%, 100% 40%, 80% 100%, 20% 100%, 0% 40%)',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.6))',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.8)',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1), inset 0 1px 2px rgba(255,255,255,0.8)'
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center text-gray-800 font-bold text-xs">
                HOME
              </div>
            </button>

            {/* Button 2 - About/Scroll */}
            <button
              onClick={() => handleButtonClick('about')}
              className={`relative w-16 h-16 transition-all duration-300 ${
                currentViewMode === 'about' ? 'opacity-100 scale-110' : 'opacity-70 hover:opacity-100 hover:scale-105'
              }`}
              style={{
                clipPath: 'polygon(50% 0%, 100% 40%, 80% 100%, 20% 100%, 0% 40%)',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.6))',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.8)',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1), inset 0 1px 2px rgba(255,255,255,0.8)'
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center text-gray-800 font-bold text-xs">
                ABOUT
              </div>
            </button>
            {/* Button 3 - CV */}
            <button
              onClick={() => handleButtonClick('CV')}
              className={`relative w-16 h-16 transition-all duration-300 ${
                currentViewMode === 'CV' ? 'opacity-100 scale-110' : 'opacity-70 hover:opacity-100 hover:scale-105'
              }`}
              style={{
                clipPath: 'polygon(50% 0%, 100% 40%, 80% 100%, 20% 100%, 0% 40%)',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.6))',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.8)',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1), inset 0 1px 2px rgba(255,255,255,0.8)'
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center text-gray-800 font-bold text-xs">
                CV
              </div>
            </button>
            {/* Button 4 - Projects */}
            <button
              onClick={() => handleButtonClick('projects')}
              className={`relative w-16 h-16 transition-all duration-300 ${
                currentViewMode === 'projects' ? 'opacity-100 scale-110' : 'opacity-70 hover:opacity-100 hover:scale-105'
              }`}
              style={{
                clipPath: 'polygon(50% 0%, 100% 40%, 80% 100%, 20% 100%, 0% 40%)',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.6))',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.8)',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1), inset 0 1px 2px rgba(255,255,255,0.8)'
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center text-gray-800 font-bold text-xs">
                PROJECTS
              </div>
            </button>

            {/* Button 5 - Contact/Icons */}
            <button
              onClick={() => handleButtonClick('icons')}
              className={`relative w-16 h-16 transition-all duration-300 ${
                currentViewMode === 'icons' ? 'opacity-100 scale-110' : 'opacity-70 hover:opacity-100 hover:scale-105'
              }`}
              style={{
                clipPath: 'polygon(50% 0%, 100% 40%, 80% 100%, 20% 100%, 0% 40%)',
                background: 'linear-gradient(135deg, rgba(255,255,255,0.9), rgba(255,255,255,0.6))',
                backdropFilter: 'blur(10px)',
                border: '1px solid rgba(255,255,255,0.8)',
                boxShadow: '0 4px 6px rgba(0,0,0,0.1), inset 0 1px 2px rgba(255,255,255,0.8)'
              }}
            >
              <div className="absolute inset-0 flex items-center justify-center text-gray-800 font-bold text-xs">
                CONTACT
              </div>
            </button>
          </div>

          {/* Social Links (when in icons mode) */}
          {viewModeRef.current === 'icons' && (
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 flex gap-8 z-20">
              <a
                href={socialLinks.mail}
                className="w-20 h-20 flex items-center justify-center bg-white bg-opacity-80 backdrop-blur-md rounded-lg shadow-lg hover:scale-110 transition-transform"
              >
                <span className="text-2xl">📧</span>
              </a>
              <a
                href={socialLinks.phone}
                className="w-20 h-20 flex items-center justify-center bg-white bg-opacity-80 backdrop-blur-md rounded-lg shadow-lg hover:scale-110 transition-transform"
              >
                <span className="text-2xl">📱</span>
              </a>
              <a
                href={socialLinks.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="w-20 h-20 flex items-center justify-center bg-white bg-opacity-80 backdrop-blur-md rounded-lg shadow-lg hover:scale-110 transition-transform"
              >
                <span className="text-2xl">💼</span>
              </a>
              <a
                href={socialLinks.github}
                target="_blank"
                rel="noopener noreferrer"
                className="w-20 h-20 flex items-center justify-center bg-white bg-opacity-80 backdrop-blur-md rounded-lg shadow-lg hover:scale-110 transition-transform"
              >
                <span className="text-2xl">💻</span>
              </a>
            </div>
          )}

          {/* Content overlay for scroll mode */}
          {/* {viewModeRef.current === 'scroll' && (
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 max-h-96 overflow-y-auto p-8 text-center z-20">
              <h2 className="text-3xl font-bold text-white mb-4">About Me</h2>
              <p className="text-white leading-relaxed">
                Add your content here. This text will appear over the scroll model.
                You can add multiple paragraphs, your bio, skills, or any other information.
              </p>
            </div>
          )} */}

          <div className=''>
            <button onClick={() => handleScrollButtonClick('previous')}
              className={`absolute top-40 left-1/2 -translate-x-1/2 -translate-y-1/2 text-white  bg-opacity-0 backdrop-blur-md rounded-lg shadow-lg p-4 hover:scale-110 transition-transform ${currentViewMode === 'CV' || currentViewMode === 'projects' ? '' : 'hidden'}`}>
              ↑
            </button>
            <button onClick={() => handleScrollButtonClick('next')}
              className={`absolute bottom-40 left-1/2 -translate-x-1/2  text-white bg-opacity-0 backdrop-blur-md rounded-lg shadow-lg p-4 hover:scale-110 transition-transform ${currentViewMode === 'CV' || currentViewMode === 'projects'  ? '' : 'hidden'}`}>
              ↓
            </button>
          </div>
          <div className="absolute top-8 left-8 text-white font-mono font-bold text-lg opacity-50">
            Andrew Li | Software Engineer
          </div>
          <div className="absolute bottom-8 left-8 text-white font-mono text-sm opacity-50">
            {viewModeRef.current === 'objects' ? `MODEL ${currentShape + 1} / ${modelDataRef.current.length}` : viewModeRef.current.toUpperCase()}
          </div>
        </>
      )}
    </div>
  );
};

