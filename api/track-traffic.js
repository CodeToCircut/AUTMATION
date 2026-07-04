import fetch from 'node-fetch';

// FOOLPROOF FEATURE 1: Automatically cleans messy Notion URLs. 
// Whether you pasted the whole link, left the "?v=" attached, or just pasted the ID, this extracts only what it needs.
function cleanNotionId(input) {
  if (!input) return null;
  let clean = input.trim();
  if (clean.includes('?')) clean = clean.split('?')[0]; // Strips ?v=...
  if (clean.includes('/')) {
    const parts = clean.split('/');
    clean = parts[parts.length - 1]; // Strips https://notion.so/...
  }
  return clean.replace(/-/g, ''); // Removes hyphens
}

export default async function handler(req, res) {
  const logs = [];
  const today = new Date().toISOString().split('T')[0];

  // FOOLPROOF FEATURE 2: Safely check and trim all environment variables so hidden spaces don't break the auth.
  const rawNotionId = process.env.NOTION_DATABASE_ID;
  const notionToken = process.env.NOTION_TOKEN?.trim();
  const githubToken = process.env.GITHUB_PAT?.trim();
  const username = process.env.GITHUB_USERNAME?.trim();

  // Stop immediately and warn the user if a variable is missing
  if (!username) return res.status(400).json({ success: false, error: "Missing GITHUB_USERNAME in environment variables." });
  if (!githubToken) return res.status(400).json({ success: false, error: "Missing GITHUB_PAT in environment variables." });
  if (!notionToken) return res.status(400).json({ success: false, error: "Missing NOTION_TOKEN in environment variables." });
  if (!rawNotionId) return res.status(400).json({ success: false, error: "Missing NOTION_DATABASE_ID in environment variables." });

  const databaseId = cleanNotionId(rawNotionId);

  try {
    const commonHeaders = {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${githubToken}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Vercel-Automated-Traffic-App'
    };

    // 1. Fetch GitHub Repositories
    const reposResponse = await fetch(`https://api.github.com/user/repos?type=owner&per_page=100`, { headers: commonHeaders });

    if (!reposResponse.ok) {
      const err = await reposResponse.text();
      throw new Error(`GitHub Auth Failed. Check if your PAT is correct and has 'repo' scope. Details: ${err}`);
    }

    const allRepos = await reposResponse.json();
    const repoNames = allRepos.map(repo => repo.name);

    if (repoNames.length === 0) {
      return res.status(200).json({ success: true, details: ["No repositories found for this GitHub account."] });
    }

    // 2. Loop through each repo safely
    for (const repo of repoNames) {
      try {
        const trafficResponse = await fetch(`https://api.github.com/repos/${username}/${repo}/traffic/views`, { headers: commonHeaders });

        if (!trafficResponse.ok) {
          logs.push(`${repo}: Skipped (GitHub blocked access to traffic)`);
          continue; // FOOLPROOF FEATURE 3: If one repo fails, skip it and keep running the rest!
        }

        const trafficData = await trafficResponse.json();
        const totalViews = trafficData.count || 0;
        const uniqueVisitors = trafficData.uniques || 0;

        // 3. Send to Notion
        const notionResponse = await fetch('https://api.notion.com/v1/pages', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${notionToken}`,
            'Content-Type': 'application/json',
            'Notion-Version': '2022-06-28'
          },
          body: JSON.stringify({
            parent: { database_id: databaseId },
            properties: {
              "Name": { title: [{ text: { content: today } }] },
              "Repository": { rich_text: [{ text: { content: repo } }] },
              "Total Views": { number: totalViews },
              "Unique Visitors": { number: uniqueVisitors }
            }
          })
        });

        // FOOLPROOF FEATURE 4: Exact Notion error decoding
        if (!notionResponse.ok) {
          const notionError = await notionResponse.json();
          logs.push(`${repo} ❌ NOTION ERROR: ${notionError.message}`);
        } else {
          logs.push(`${repo} ✅ Success (${totalViews} views)`);
        }

      } catch (repoError) {
        logs.push(`${repo} ❌ CRASH: ${repoError.message}`);
      }
    }

    return res.status(200).json({ success: true, details: logs });

  } catch (error) {
    return res.status(500).json({ success: false, error: error.message });
  }
}
