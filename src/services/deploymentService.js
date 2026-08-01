const { logger } = require("../middleware/logger");

/**
 * Pushes generated files to a GitHub repository.
 * If the repository does not exist, it will be created.
 *
 * @param {string} projectName The name of the project
 * @param {Array<{path: string, content: string}>} files List of files with path and content
 * @returns {Promise<string>} The URL of the GitHub repository
 */
async function pushToGitHub(projectName, files) {
  const token = process.env.GITHUB_TOKEN;
  if (!token || !token.trim()) {
    throw new Error("Missing GITHUB_TOKEN environment variable.");
  }

  if (!files || !Array.isArray(files) || files.length === 0) {
    throw new Error("No files provided to push to GitHub.");
  }

  const cleanedProjName = projectName || "apex-build";
  // Clean the project name to be a valid GitHub repo name
  const repoName = cleanedProjName
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  const headers = {
    Authorization: `Bearer ${token.trim()}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "APEX-OS-Agent",
  };

  logger.info(`Authenticating with GitHub to push project: ${repoName}`);

  // 1. Fetch authenticated user's login name
  const userRes = await fetch("https://api.github.com/user", { headers });
  if (!userRes.ok) {
    const errText = await userRes.text();
    throw new Error(`GitHub Authentication failed: ${userRes.status} ${errText}`);
  }
  const userData = await userRes.json();
  const username = userData.login;
  if (!username) {
    throw new Error("Could not retrieve GitHub username from token.");
  }

  logger.info(`Successfully authenticated as GitHub user: ${username}`);

  // 2. Check if repository exists or create a new one
  let repoExists = false;
  const repoCheckUrl = `https://api.github.com/repos/${username}/${repoName}`;
  const checkRes = await fetch(repoCheckUrl, { headers });

  if (checkRes.ok) {
    repoExists = true;
    logger.info(`GitHub repository already exists: ${username}/${repoName}`);
  } else if (checkRes.status === 404) {
    logger.info(`Creating new GitHub repository: ${username}/${repoName}`);
    const createRes = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: repoName,
        description: `Build package for ${projectName} generated via APEX OS Build Pipeline`,
        private: false,
        auto_init: true, // Creates a default README and main branch
      }),
    });

    if (!createRes.ok) {
      const errText = await createRes.text();
      throw new Error(`Failed to create GitHub repository: ${createRes.status} ${errText}`);
    }
    logger.info(`Successfully created GitHub repository: ${username}/${repoName}`);
    // Wait a brief moment for GitHub to initialize the repo
    await new Promise((resolve) => setTimeout(resolve, 2000));
  } else {
    const errText = await checkRes.text();
    throw new Error(`Failed to check repository existence: ${checkRes.status} ${errText}`);
  }

  // 3. Push files sequentially
  const targetBranch = "main";
  const pushedFiles = [];

  for (const file of files) {
    const contentB64 = Buffer.from(file.content || "").toString("base64");
    let sha;

    // Check if file already exists to get its SHA (needed for updates)
    try {
      const fileCheckRes = await fetch(
        `https://api.github.com/repos/${username}/${repoName}/contents/${encodeURIComponent(file.path)}?ref=${targetBranch}`,
        { headers }
      );
      if (fileCheckRes.ok) {
        const fileData = await fileCheckRes.json();
        sha = fileData.sha;
      }
    } catch (e) {
      logger.warn(`Could not check existence of ${file.path}: ${e.message}`);
    }

    const putRes = await fetch(
      `https://api.github.com/repos/${username}/${repoName}/contents/${encodeURIComponent(file.path)}`,
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          message: `Add/update ${file.path} via APEX OS Build Pipeline`,
          content: contentB64,
          branch: targetBranch,
          ...(sha ? { sha } : {}),
        }),
      }
    );

    if (!putRes.ok) {
      const errText = await putRes.text();
      throw new Error(`Failed to push file ${file.path}: ${putRes.status} ${errText}`);
    }
    pushedFiles.push(file.path);
  }

  const repoUrl = `https://github.com/${username}/${repoName}`;
  logger.info(`Successfully pushed ${pushedFiles.length} files to GitHub repo: ${repoUrl}`);
  return repoUrl;
}

/**
 * Deploys a GitHub repository to Render as a static site or web service.
 * If the service already exists, it triggers a new deploy.
 *
 * @param {string} repoUrl The GitHub repository URL to deploy
 * @param {string} projectName The name of the project
 * @returns {Promise<string>} The live URL of the Render deployment
 */
async function deployToRender(repoUrl, projectName) {
  const renderApiKey = process.env.RENDER_API_KEY;
  if (!renderApiKey || !renderApiKey.trim()) {
    throw new Error("Missing RENDER_API_KEY environment variable.");
  }

  const renderHeaders = {
    Authorization: `Bearer ${renderApiKey.trim()}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  logger.info(`Authenticating with Render API for repository: ${repoUrl}`);

  // 1. Fetch owners to get the required ownerId
  const ownersRes = await fetch("https://api.render.com/v1/owners", { headers: renderHeaders });
  if (!ownersRes.ok) {
    const errText = await ownersRes.text();
    throw new Error(`Failed to authenticate with Render or fetch owners: ${ownersRes.status} ${errText}`);
  }
  const owners = await ownersRes.json();
  if (!owners || owners.length === 0) {
    throw new Error("No Render owners/accounts found for the provided API key.");
  }
  const ownerId = owners[0].owner?.id || owners[0].id;
  if (!ownerId) {
    throw new Error("Could not extract a valid Owner ID from Render.");
  }

  logger.info(`Found Render Owner ID: ${ownerId}`);

  const cleanedProjName = projectName || "apex-build";
  const serviceName = cleanedProjName
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  // 2. Check if a service with this repo/name already exists
  let existingService = null;
  const listServicesRes = await fetch("https://api.render.com/v1/services?limit=100", { headers: renderHeaders });
  if (listServicesRes.ok) {
    const services = await listServicesRes.json();
    existingService = services.find(
      (s) => s.service?.repo === repoUrl || s.service?.name === serviceName
    );
  }

  if (existingService) {
    const serviceId = existingService.service.id;
    logger.info(`Render service already exists. Triggering new deploy for service ID: ${serviceId}`);

    const deployRes = await fetch(`https://api.render.com/v1/services/${serviceId}/deploys`, {
      method: "POST",
      headers: renderHeaders,
      body: JSON.stringify({}),
    });

    if (!deployRes.ok) {
      const errText = await deployRes.text();
      throw new Error(`Failed to trigger Render deploy: ${deployRes.status} ${errText}`);
    }

    const deployData = await deployRes.json();
    const liveUrl = existingService.service.url || `https://${serviceName}.onrender.com`;
    logger.info(`Successfully triggered Render redeployment. Live URL: ${liveUrl}`);
    return liveUrl;
  }

  // 3. Create a new service pointing at the repository
  logger.info(`Creating a new Render Static Site service: ${serviceName}`);
  const createServiceRes = await fetch("https://api.render.com/v1/services", {
    method: "POST",
    headers: renderHeaders,
    body: JSON.stringify({
      type: "static_site",
      name: serviceName,
      ownerId: ownerId,
      repo: repoUrl,
      autoDeploy: "yes",
      serviceDetails: {
        publishDir: "dist" // Default public assets build folder for static sites (like Vite/React)
      }
    }),
  });

  if (!createServiceRes.ok) {
    const errText = await createServiceRes.text();
    throw new Error(`Failed to create Render service: ${createServiceRes.status} ${errText}`);
  }

  const serviceData = await createServiceRes.json();
  const liveUrl = serviceData.service?.url || `https://${serviceName}.onrender.com`;
  logger.info(`Successfully created Render service. Live URL: ${liveUrl}`);
  return liveUrl;
}

module.exports = {
  pushToGitHub,
  deployToRender,
};
