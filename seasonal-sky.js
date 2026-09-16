// One seed-stable cloud field in planet coordinates, shared by the sky, stars
// and falling snow. Clear areas are actual places, not a camera-space overlay.
export const CLOUD_FIELD_GLSL = `
  uniform float weatherSeed;
  float campCloudCover(vec3 direction) {
    vec3 p = direction * 5.0 + vec3(weatherSeed, weatherSeed * 0.73, -weatherSeed * 0.41);
    float broad = sin(p.x + sin(p.z * 0.8) * 0.7) * cos(p.y * 0.85 - p.z * 0.35);
    float folds = sin(p.z * 1.6 + p.y * 0.7 + sin(p.x)) * cos(p.x * 0.8 - p.y * 1.2);
    float detail = sin(p.x * 3.1 + p.z * 2.3) * sin(p.y * 2.7 - p.z);
    return smoothstep(0.35, 0.67, 0.5 + broad * 0.30 + folds * 0.18 + detail * 0.06);
  }
`;

const SKY_WEATHER_GLSL = `
  ${CLOUD_FIELD_GLSL}
  uniform mat3 weatherInverse;
  uniform vec3 weatherObserver;
  uniform float weatherRadius;
  uniform float winterSky;
  float campSkyCloud(vec3 worldRay) {
    vec3 ray = normalize(weatherInverse * worldRay);
    // Project the view into a cloud shell above the camper. Using the camper,
    // rather than the zoomed-out camera, keeps overhead weather on their region.
    vec3 origin = weatherObserver * (weatherRadius + 0.8);
    float shell = weatherRadius + 15.0; // The top of the snowfall volume.
    float b = dot(origin, ray);
    float travel = -b + sqrt(max(0.0, b * b + shell * shell - dot(origin, origin)));
    return campCloudCover(normalize(origin + ray * travel));
  }
`;

export function createSeasonalSky(THREE, { scene, camera, starMat, radius, seed }) {
  const weatherUniforms = {
    weatherSeed: { value: (Number(seed) % 997) * 0.071 },
    weatherInverse: { value: new THREE.Matrix3() },
    weatherObserver: { value: new THREE.Vector3(0, 1, 0) },
    weatherRadius: { value: radius },
    winterSky: { value: 0 }
  };
  const uniforms = {
    ...weatherUniforms,
    skyBase: { value: new THREE.Color(0x68b8e8) },
    rose: { value: new THREE.Color(0xff8fbd) },
    lavender: { value: new THREE.Color(0xc29bdf) },
    winterClearDay: { value: new THREE.Color(0x789bc5) },
    winterClearNight: { value: new THREE.Color(0x01030a) },
    winterCloudNight: { value: new THREE.Color(0x18212d) },
    daylight: { value: 1 }, twilight: { value: 0 },
    sunAltitude: { value: 1 }, nightVisibility: { value: 0 }, skyTime: { value: 0 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms, side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false, toneMapped: false,
    vertexShader: `
      varying vec3 skyDirection;
      void main() {
        skyDirection = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      ${SKY_WEATHER_GLSL}
      varying vec3 skyDirection;
      uniform vec3 skyBase, rose, lavender, winterClearDay, winterClearNight, winterCloudNight;
      uniform float daylight, twilight, sunAltitude, nightVisibility, skyTime;

      vec3 auroraCurtain(vec3 direction, float offset) {
        float longitude = atan(direction.z, direction.x + 0.000001);
        float t = skyTime * 0.035;
        // Integer angular frequencies meet cleanly at the longitude seam.
        float base = 0.24 + offset + sin(longitude * 3.0 + t) * 0.065
          + sin(longitude * 7.0 - t * 0.6) * 0.035;
        float height = (direction.y - base) / 0.38;
        float veil = smoothstep(0.0, 0.06, height) * (1.0 - smoothstep(0.12, 1.0, height));
        float strands = pow(0.5 + 0.5 * sin(longitude * 96.0 + sin(longitude * 9.0 + t) * 6.0 - t * 2.0), 3.0);
        float edgeDistance = (height - 0.08) / 0.065;
        float brightEdge = exp(-edgeDistance * edgeDistance);
        vec3 color = mix(vec3(0.025, 0.36, 0.16), vec3(0.19, 0.035, 0.32), smoothstep(0.12, 0.85, height));
        return color * veil * (0.24 + strands * 0.76) + vec3(0.025, 0.18, 0.13) * brightEdge;
      }

      void main() {
        vec3 ray = normalize(skyDirection);
        vec3 localRay = normalize(weatherInverse * ray);
        vec3 color = skyBase;
        if (winterSky < 0.5) {
          // The orange remains dominant, with broad rose patches and a few
          // softer lavender wisps higher up rather than a uniform pink wash.
          float patches = campCloudCover(localRay);
          float horizonDistance = (ray.y - 0.08) / 0.65;
          float horizon = exp(-horizonDistance * horizonDistance);
          float wisps = smoothstep(0.3, 0.9, 0.5 + 0.5 * sin(localRay.y * 17.0 + localRay.x * 5.0 + patches * 3.0));
          color = mix(color, rose, twilight * patches * horizon * 0.58);
          color = mix(color, lavender, twilight * patches * wisps * smoothstep(0.15, 0.8, ray.y) * 0.22);
        } else {
          float clouds = campSkyCloud(ray);
          float clearLight = smoothstep(0.0, 0.28, sunAltitude);
          vec3 clearSky = mix(winterClearNight, winterClearDay, clearLight);
          float cloudLight = clamp(daylight + twilight, 0.0, 1.0);
          vec3 cloudSky = mix(winterCloudNight, skyBase, cloudLight);
          cloudSky *= 0.90 + clouds * 0.10;
          color = mix(clearSky, cloudSky, clouds);
          float opening = 1.0 - smoothstep(0.10, 0.72, clouds);
          vec3 aurora = auroraCurtain(localRay, 0.0) + auroraCurtain(localRay, 0.22) * 0.45;
          color += aurora * opening * nightVisibility;
        }
        gl_FragColor = vec4(color, 1.0);
        #include <colorspace_fragment>
      }
    `
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(240, 32, 20), material);
  dome.name = 'seasonal-sky'; dome.frustumCulled = false; dome.renderOrder = -1000;
  scene.add(dome);

  // Stars use the exact same view-ray/cloud-shell lookup as the background.
  // This avoids stars shining through the gray parts of the winter sky.
  starMat.depthWrite = false;
  starMat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, weatherUniforms);
    shader.vertexShader = `${SKY_WEATHER_GLSL}\nvarying float starCloudVisibility;\n` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 starRay = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
      starCloudVisibility = 1.0 - winterSky * smoothstep(0.10, 0.72, campSkyCloud(starRay));
    `);
    shader.fragmentShader = 'varying float starCloudVisibility;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>',
      '#include <color_fragment>\ndiffuseColor.a *= starCloudVisibility;');
  };
  starMat.needsUpdate = true;

  const inverse = new THREE.Quaternion(), rotationMatrix = new THREE.Matrix4();
  function update({ rotation, playerPosition, winter, skyColor, daylight, twilight, sunAltitude, time }) {
    inverse.copy(rotation).invert();
    weatherUniforms.weatherInverse.value.setFromMatrix4(rotationMatrix.makeRotationFromQuaternion(inverse));
    weatherUniforms.weatherObserver.value.copy(playerPosition).normalize().applyQuaternion(inverse);
    weatherUniforms.winterSky.value = winter ? 1 : 0;
    uniforms.skyBase.value.copy(skyColor);
    uniforms.daylight.value = daylight; uniforms.twilight.value = twilight;
    uniforms.sunAltitude.value = sunAltitude; uniforms.skyTime.value = time;
    const night = winter ? 1 - THREE.MathUtils.smoothstep(sunAltitude, -0.16, 0.08)
      : 1 - THREE.MathUtils.smoothstep(sunAltitude, -0.25, 0.02);
    uniforms.nightVisibility.value = night;
    starMat.opacity = night;
    camera.getWorldPosition(dome.position);
  }
  return { update, weatherUniforms };
}
