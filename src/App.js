import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react';
import { generateClient } from 'aws-amplify/api';
import { getCurrentUser, fetchUserAttributes } from '@aws-amplify/auth';
import { v4 as uuidv4 } from 'uuid';

const ADMIN_EMAILS = ['samywine2@gmail.com'];

const getUploadUrlMutation = `
mutation GetUploadUrl($fileName: String!, $fileType: String!) {
  getUploadUrl(fileName: $fileName, fileType: $fileType) {
    uploadURL
    key
  }
}
`;

const getDownloadUrlQuery = `
query GetDownloadUrl($s3Key: String!) {
  getDownloadUrl(s3Key: $s3Key) {
    uploadURL
    key
  }
}
`;

const deleteFileCascadeMutation = `
mutation DeleteFileCascade($fileId: ID!, $s3Key: String!) {
  deleteFileCascade(fileId: $fileId, s3Key: $s3Key) {
    uploadURL
    key
  }
}
`;

const createFileMutation = `
mutation CreateFile(
  $fileId: ID!,
  $fileName: String!,
  $s3Key: String!,
  $fileType: String,
  $fileSize: Int,
  $version: Int!,
  $owner: String!,
  $sharedWith: [String]
) {
  createFile(
    fileId: $fileId,
    fileName: $fileName,
    s3Key: $s3Key,
    fileType: $fileType,
    fileSize: $fileSize,
    version: $version,
    owner: $owner,
    sharedWith: $sharedWith
  ) {
    fileId
    fileName
    s3Key
    fileType
    fileSize
    version
    owner
    sharedWith
    createdAt
    updatedAt
  }
}
`;

const shareFileMutation = `
mutation ShareFile(
  $shareId: ID!,
  $fileId: ID!,
  $owner: String!,
  $sharedWithUser: String!,
  $permission: String,
  $createdAt: AWSDateTime
) {
  shareFile(
    shareId: $shareId,
    fileId: $fileId,
    owner: $owner,
    sharedWithUser: $sharedWithUser,
    permission: $permission,
    createdAt: $createdAt
  ) {
    shareId
    fileId
    owner
    sharedWithUser
    permission
    createdAt
  }
}
`;

const listFilesQuery = `
query ListFiles {
  listFiles {
    fileId
    fileName
    s3Key
    fileType
    fileSize
    version
    owner
    sharedWith
    createdAt
    updatedAt
  }
}
`;

const listSharesQuery = `
query ListShares($fileId: ID!) {
  listShares(fileId: $fileId) {
    shareId
    fileId
    owner
    sharedWithUser
    permission
    createdAt
  }
}
`;

const createCommentMutation = `
mutation CreateComment(
  $commentId: ID!,
  $fileId: ID!,
  $content: String!,
  $owner: String!,
  $createdAt: AWSDateTime
) {
  createComment(
    commentId: $commentId,
    fileId: $fileId,
    content: $content,
    owner: $owner,
    createdAt: $createdAt
  ) {
    commentId
    fileId
    content
    owner
    createdAt
  }
}
`;

const getCommentsByFileQuery = `
query GetCommentsByFile($fileId: ID!) {
  getCommentsByFile(fileId: $fileId) {
    commentId
    fileId
    content
    owner
    createdAt
  }
}
`;

function MainApp() {
  const client = generateClient();
  const { signOut } = useAuthenticator((context) => [context.user]);

  const [user, setUser] = useState(null);
  const [userEmail, setUserEmail] = useState('');
  const [selectedFile, setSelectedFile] = useState(null);
  const [files, setFiles] = useState([]);
  const [comments, setComments] = useState({});
  const [commentInputs, setCommentInputs] = useState({});
  const [shareInputs, setShareInputs] = useState({});
  const [sharePermissions, setSharePermissions] = useState({});
  const [sharesByFile, setSharesByFile] = useState({});
  const [statusMessage, setStatusMessage] = useState('');
  const [uploading, setUploading] = useState(false);
  const [downloadingKey, setDownloadingKey] = useState('');
  const [deletingFileId, setDeletingFileId] = useState('');
  const [loadingCommentsFileId, setLoadingCommentsFileId] = useState('');
  const [addingCommentFileId, setAddingCommentFileId] = useState('');
  const [sharingFileId, setSharingFileId] = useState('');
  const [loadingSharesFileId, setLoadingSharesFileId] = useState('');

  const isAdmin = useMemo(() => {
    return ADMIN_EMAILS.includes(userEmail.toLowerCase());
  }, [userEmail]);

  useEffect(() => {
    loadCurrentUser();
  }, []);

  const loadCurrentUser = async () => {
    try {
      const currentUser = await getCurrentUser();
      const attributes = await fetchUserAttributes();

      setUser(currentUser);
      setUserEmail(attributes.email || '');
    } catch (error) {
      console.error('Error loading current user:', error);
    }
  };

  const loadFiles = useCallback(async () => {
    try {
      const result = await client.graphql({
        query: listFilesQuery,
        authMode: 'userPool'
      });

      const allFiles = result?.data?.listFiles || [];

      if (isAdmin) {
        setFiles(allFiles);
        return;
      }

      const visibleFiles = [];

      for (const file of allFiles) {
        const ownerMatch = file.owner === userEmail || file.owner === user?.username;

        if (ownerMatch) {
          visibleFiles.push(file);
          continue;
        }

        try {
          const sharesResult = await client.graphql({
            query: listSharesQuery,
            variables: { fileId: file.fileId },
            authMode: 'userPool'
          });

          const shares = sharesResult?.data?.listShares || [];

          const sharedWithCurrentUser = shares.some(
            (share) => share.sharedWithUser?.toLowerCase() === userEmail.toLowerCase()
          );

          if (sharedWithCurrentUser) {
            visibleFiles.push(file);
          }
        } catch (shareError) {
          console.error(`Error checking shares for file ${file.fileId}:`, shareError);
        }
      }

      setFiles(visibleFiles);
    } catch (error) {
      console.error('Error loading files:', error);
      setStatusMessage('Could not load files.');
    }
  }, [client, isAdmin, userEmail, user]);

  useEffect(() => {
    if (user) {
      loadFiles();
    }
  }, [user, loadFiles]);

  const uploadFile = async () => {
    try {
      if (!selectedFile || !user) {
        setStatusMessage('Please choose a file first.');
        return;
      }

      setUploading(true);
      setStatusMessage('Uploading file...');

      const uploadResult = await client.graphql({
        query: getUploadUrlMutation,
        variables: {
          fileName: selectedFile.name,
          fileType: selectedFile.type || 'application/octet-stream'
        },
        authMode: 'userPool'
      });

      const { uploadURL, key } = uploadResult.data.getUploadUrl;

      const s3Response = await fetch(uploadURL, {
        method: 'PUT',
        headers: {
          'Content-Type': selectedFile.type || 'application/octet-stream'
        },
        body: selectedFile
      });

      if (!s3Response.ok) {
        throw new Error('S3 upload failed');
      }

      await client.graphql({
        query: createFileMutation,
        variables: {
          fileId: uuidv4(),
          fileName: selectedFile.name,
          s3Key: key,
          fileType: selectedFile.type || 'application/octet-stream',
          fileSize: selectedFile.size,
          version: 1,
          owner: userEmail || user.username,
          sharedWith: []
        },
        authMode: 'userPool'
      });

      setSelectedFile(null);
      setStatusMessage('File uploaded successfully.');
      await loadFiles();
    } catch (error) {
      console.error('Upload error:', error);
      setStatusMessage('Upload failed. Check browser console.');
    } finally {
      setUploading(false);
    }
  };

  const downloadFile = async (s3Key) => {
    try {
      setDownloadingKey(s3Key);
      setStatusMessage('Preparing download...');

      const result = await client.graphql({
        query: getDownloadUrlQuery,
        variables: { s3Key },
        authMode: 'userPool'
      });

      const downloadURL = result?.data?.getDownloadUrl?.uploadURL;

      if (!downloadURL) {
        throw new Error('No download URL returned');
      }

      window.open(downloadURL, '_blank');
      setStatusMessage('Download started.');
    } catch (error) {
      console.error('Error downloading file:', error);
      setStatusMessage('Download failed. Check browser console.');
    } finally {
      setDownloadingKey('');
    }
  };

  const canDeleteFile = (file) => {
    if (isAdmin) return true;
    return file.owner === userEmail || file.owner === user?.username;
  };

  const canShareFile = (file) => {
    if (isAdmin) return true;
    return file.owner === userEmail || file.owner === user?.username;
  };

  const deleteFile = async (fileId, s3Key, fileName) => {
    try {
      if (!canDeleteFile({ fileId, s3Key, fileName, owner: files.find((f) => f.fileId === fileId)?.owner })) {
        setStatusMessage('You are not allowed to delete this file.');
        return;
      }

      const confirmed = window.confirm(`Delete "${fileName}" and all related comments/shares?`);
      if (!confirmed) return;

      setDeletingFileId(fileId);
      setStatusMessage('Deleting file and related data...');

      await client.graphql({
        query: deleteFileCascadeMutation,
        variables: { fileId, s3Key },
        authMode: 'userPool'
      });

      setComments((prev) => {
        const updated = { ...prev };
        delete updated[fileId];
        return updated;
      });

      setCommentInputs((prev) => {
        const updated = { ...prev };
        delete updated[fileId];
        return updated;
      });

      setSharesByFile((prev) => {
        const updated = { ...prev };
        delete updated[fileId];
        return updated;
      });

      setStatusMessage('File and related data deleted successfully.');
      await loadFiles();
    } catch (error) {
      console.error('Error deleting file:', error);
      setStatusMessage('Delete failed. Check browser console.');
    } finally {
      setDeletingFileId('');
    }
  };

  const loadComments = async (fileId) => {
    try {
      setLoadingCommentsFileId(fileId);
      setStatusMessage('Loading comments...');

      const result = await client.graphql({
        query: getCommentsByFileQuery,
        variables: { fileId },
        authMode: 'userPool'
      });

      setComments((prev) => ({
        ...prev,
        [fileId]: result?.data?.getCommentsByFile || []
      }));

      setStatusMessage('Comments loaded.');
    } catch (error) {
      console.error('Error loading comments:', error);
      setStatusMessage('Could not load comments.');
    } finally {
      setLoadingCommentsFileId('');
    }
  };

  const loadShares = async (fileId) => {
    try {
      setLoadingSharesFileId(fileId);
      setStatusMessage('Loading shares...');

      const result = await client.graphql({
        query: listSharesQuery,
        variables: { fileId },
        authMode: 'userPool'
      });

      setSharesByFile((prev) => ({
        ...prev,
        [fileId]: result?.data?.listShares || []
      }));

      setStatusMessage('Shares loaded.');
    } catch (error) {
      console.error('Error loading shares:', error);
      setStatusMessage('Could not load shares.');
    } finally {
      setLoadingSharesFileId('');
    }
  };

  const shareFile = async (file) => {
    try {
      if (!canShareFile(file)) {
        setStatusMessage('You are not allowed to share this file.');
        return;
      }

      const targetEmail = (shareInputs[file.fileId] || '').trim().toLowerCase();
      const permission = sharePermissions[file.fileId] || 'read';

      if (!targetEmail) {
        setStatusMessage('Please enter an email to share with.');
        return;
      }

      if (targetEmail === userEmail.toLowerCase()) {
        setStatusMessage('You already own this file.');
        return;
      }

      setSharingFileId(file.fileId);
      setStatusMessage('Sharing file...');

      await client.graphql({
        query: shareFileMutation,
        variables: {
          shareId: uuidv4(),
          fileId: file.fileId,
          owner: file.owner,
          sharedWithUser: targetEmail,
          permission,
          createdAt: new Date().toISOString()
        },
        authMode: 'userPool'
      });

      const updatedSharedWith = Array.isArray(file.sharedWith)
        ? Array.from(new Set([...file.sharedWith, targetEmail]))
        : [targetEmail];

      setFiles((prev) =>
        prev.map((item) =>
          item.fileId === file.fileId
            ? { ...item, sharedWith: updatedSharedWith }
            : item
        )
      );

      setShareInputs((prev) => ({
        ...prev,
        [file.fileId]: ''
      }));

      setSharePermissions((prev) => ({
        ...prev,
        [file.fileId]: 'read'
      }));

      await loadShares(file.fileId);
      setStatusMessage(`File shared with ${targetEmail}.`);
    } catch (error) {
      console.error('Error sharing file:', error);
      setStatusMessage('Could not share file.');
    } finally {
      setSharingFileId('');
    }
  };

  const addComment = async (fileId) => {
    try {
      const content = commentInputs[fileId];
      if (!content || !user) {
        setStatusMessage('Please enter a comment first.');
        return;
      }

      setAddingCommentFileId(fileId);
      setStatusMessage('Adding comment...');

      await client.graphql({
        query: createCommentMutation,
        variables: {
          commentId: uuidv4(),
          fileId,
          content,
          owner: userEmail || user.username,
          createdAt: new Date().toISOString()
        },
        authMode: 'userPool'
      });

      setCommentInputs((prev) => ({
        ...prev,
        [fileId]: ''
      }));

      await loadComments(fileId);
      setStatusMessage('Comment added successfully.');
    } catch (error) {
      console.error('Error creating comment:', error);
      setStatusMessage('Could not add comment.');
    } finally {
      setAddingCommentFileId('');
    }
  };

  const displayOwner = (ownerValue) => {
    if (ownerValue === user?.username && userEmail) {
      return userEmail;
    }
    return ownerValue;
  };

  return (
    <div style={{ maxWidth: '950px', margin: '0 auto', padding: '24px', fontFamily: 'Arial, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <h1 style={{ margin: 0 }}>Serverless File Sharing Platform</h1>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <span style={{ fontSize: '14px', color: '#555' }}>
            {isAdmin ? 'Admin user' : userEmail}
          </span>
          <button onClick={signOut} style={{ padding: '8px 14px' }}>
            Sign Out
          </button>
        </div>
      </div>

      {statusMessage && (
        <div
          style={{
            marginBottom: '16px',
            padding: '10px 12px',
            background: '#f7f7f7',
            border: '1px solid #ddd',
            borderRadius: '8px'
          }}
        >
          {statusMessage}
        </div>
      )}

      <div style={{ border: '1px solid #ddd', borderRadius: '10px', padding: '16px', marginBottom: '16px' }}>
        <h2>Upload File</h2>
        <input type="file" onChange={(e) => setSelectedFile(e.target.files[0])} />
        <button
          onClick={uploadFile}
          disabled={uploading}
          style={{ marginLeft: '10px', padding: '8px 14px' }}
        >
          {uploading ? 'Uploading...' : 'Upload'}
        </button>
      </div>

      <div style={{ border: '1px solid #ddd', borderRadius: '10px', padding: '16px' }}>
        <h2>Files</h2>

        {files.length === 0 ? (
          <p>No files found</p>
        ) : (
          files.map((file) => (
            <div
              key={file.fileId}
              style={{
                border: '1px solid #ccc',
                borderRadius: '8px',
                padding: '14px',
                marginBottom: '14px',
                background: '#fff'
              }}
            >
              <p><strong>Name:</strong> {file.fileName}</p>
              <p><strong>Owner:</strong> {displayOwner(file.owner)}</p>
              <p><strong>Version:</strong> {file.version}</p>
              <p><strong>Type:</strong> {file.fileType}</p>
              <p><strong>Size:</strong> {file.fileSize}</p>

              <div style={{ marginBottom: '12px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                <button
                  onClick={() => downloadFile(file.s3Key)}
                  disabled={downloadingKey === file.s3Key}
                  style={{ padding: '6px 12px' }}
                >
                  {downloadingKey === file.s3Key ? 'Downloading...' : 'Download'}
                </button>

                <button
                  onClick={() => loadComments(file.fileId)}
                  disabled={loadingCommentsFileId === file.fileId}
                  style={{ padding: '6px 12px' }}
                >
                  {loadingCommentsFileId === file.fileId ? 'Loading...' : 'Load Comments'}
                </button>

                <button
                  onClick={() => loadShares(file.fileId)}
                  disabled={loadingSharesFileId === file.fileId}
                  style={{ padding: '6px 12px' }}
                >
                  {loadingSharesFileId === file.fileId ? 'Loading Shares...' : 'Load Shares'}
                </button>

                {canDeleteFile(file) && (
                  <button
                    onClick={() => deleteFile(file.fileId, file.s3Key, file.fileName)}
                    disabled={deletingFileId === file.fileId}
                    style={{ padding: '6px 12px' }}
                  >
                    {deletingFileId === file.fileId ? 'Deleting...' : 'Delete'}
                  </button>
                )}
              </div>

              {canShareFile(file) && (
                <div style={{ marginBottom: '12px', padding: '10px', background: '#fafafa', borderRadius: '8px' }}>
                  <strong>Share file</strong>
                  <div style={{ marginTop: '8px', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                    <input
                      type="email"
                      placeholder="Enter email address"
                      value={shareInputs[file.fileId] || ''}
                      onChange={(e) =>
                        setShareInputs((prev) => ({
                          ...prev,
                          [file.fileId]: e.target.value
                        }))
                      }
                      style={{ padding: '8px', width: '260px' }}
                    />

                    <select
                      value={sharePermissions[file.fileId] || 'read'}
                      onChange={(e) =>
                        setSharePermissions((prev) => ({
                          ...prev,
                          [file.fileId]: e.target.value
                        }))
                      }
                      style={{ padding: '8px' }}
                    >
                      <option value="read">Read</option>
                      <option value="write">Write</option>
                    </select>

                    <button
                      onClick={() => shareFile(file)}
                      disabled={sharingFileId === file.fileId}
                      style={{ padding: '8px 12px' }}
                    >
                      {sharingFileId === file.fileId ? 'Sharing...' : 'Share'}
                    </button>
                  </div>
                </div>
              )}

              <div style={{ marginBottom: '10px' }}>
                <input
                  type="text"
                  placeholder="Write a comment"
                  value={commentInputs[file.fileId] || ''}
                  onChange={(e) =>
                    setCommentInputs((prev) => ({
                      ...prev,
                      [file.fileId]: e.target.value
                    }))
                  }
                  style={{ padding: '8px', width: '70%', maxWidth: '420px' }}
                />
                <button
                  onClick={() => addComment(file.fileId)}
                  disabled={addingCommentFileId === file.fileId}
                  style={{ marginLeft: '10px', padding: '8px 12px' }}
                >
                  {addingCommentFileId === file.fileId ? 'Adding...' : 'Add Comment'}
                </button>
              </div>

              <div style={{ background: '#f7f7f7', padding: '10px', borderRadius: '6px', marginBottom: '10px' }}>
                <strong>Comments:</strong>
                {(comments[file.fileId] || []).length === 0 ? (
                  <p>No comments yet</p>
                ) : (
                  (comments[file.fileId] || []).map((comment) => (
                    <div key={comment.commentId} style={{ marginTop: '6px' }}>
                      {displayOwner(comment.owner)}: {comment.content}
                    </div>
                  ))
                )}
              </div>

              <div style={{ background: '#f7f7f7', padding: '10px', borderRadius: '6px' }}>
                <strong>Shares:</strong>
                {(sharesByFile[file.fileId] || []).length === 0 ? (
                  <p>No shares loaded yet</p>
                ) : (
                  (sharesByFile[file.fileId] || []).map((share) => (
                    <div key={share.shareId} style={{ marginTop: '6px' }}>
                      {share.sharedWithUser} ({share.permission || 'read'})
                    </div>
                  ))
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <Authenticator>
      <MainApp />
    </Authenticator>
  );
}